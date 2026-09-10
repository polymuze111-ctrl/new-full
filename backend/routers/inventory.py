"""Inventory router — measurement units DB, stock items, recipes, movement
ledger, and pay-time auto-deduction. Stock is always stored in BASE units
(ml for volume, g for mass, unit for count) so units stay freely editable."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import make_current_user_dep
from deps import _oid, db, serialize, sl
from models import InventoryItemIn, RecipeIn, StockAdjustIn, UnitIn

get_current_user = make_current_user_dep(lambda: db)

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


def _mgr(user: dict):
    if user["role"] not in ("admin", "manager"):
        raise HTTPException(403, "Manager only")


async def _units_map() -> dict:
    return {
        str(u["_id"]): u
        for u in await db.units.find({"active": {"$ne": False}}).to_list(200)
    }


def _to_base(qty: float, unit_id: Optional[str], units: dict) -> float:
    """qty expressed in unit_id → base units. Unknown unit => treated as base."""
    u = units.get(str(unit_id)) if unit_id else None
    return qty * (u.get("factor_to_base", 1.0) if u else 1.0)


def _enrich(item: dict, units: dict) -> dict:
    s = serialize(item)
    usage = units.get(str(item.get("usage_unit_id") or ""))
    factor = usage.get("factor_to_base", 1.0) if usage else 1.0
    s["stock"] = round((item.get("stock_base", 0.0) or 0.0) / factor, 3)
    s["usage_unit_symbol"] = usage.get("symbol") if usage else None
    purchase = units.get(str(item.get("purchase_unit_id") or ""))
    s["purchase_unit_symbol"] = purchase.get("symbol") if purchase else None
    s["low_stock"] = (
        bool(item.get("reorder_level")) and 0 < s["stock"] <= item["reorder_level"]
    )
    s["out_of_stock"] = s["stock"] <= 0
    pf = purchase.get("factor_to_base", 1.0) if purchase else 1.0
    s["stock_value"] = (
        round(
            (item.get("stock_base", 0.0) / pf)
            * item.get("cost_per_purchase_unit", 0.0),
            2,
        )
        if pf
        else 0.0
    )
    return s


# ===================== UNITS =====================
@router.get("/units")
async def list_units(user: dict = Depends(get_current_user)):
    return sl(
        await db.units.find().sort([("kind", 1), ("factor_to_base", 1)]).to_list(200)
    )


@router.post("/units")
async def create_unit(body: UnitIn, user: dict = Depends(get_current_user)):
    _mgr(user)
    symbol = body.symbol.strip().lower()
    if await db.units.find_one({"symbol": symbol}):
        raise HTTPException(400, f"Unit symbol '{symbol}' already exists")
    doc = body.model_dump()
    doc["symbol"] = symbol
    doc["custom"] = True
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.units.insert_one(doc)
    doc["_id"] = r.inserted_id
    return serialize(doc)


@router.patch("/units/{uid}")
async def update_unit(uid: str, body: UnitIn, user: dict = Depends(get_current_user)):
    _mgr(user)
    doc = body.model_dump()
    doc["symbol"] = doc["symbol"].strip().lower()
    await db.units.update_one({"_id": _oid(uid)}, {"$set": doc})
    return serialize(await db.units.find_one({"_id": _oid(uid)}))


@router.delete("/units/{uid}")
async def delete_unit(uid: str, user: dict = Depends(get_current_user)):
    _mgr(user)
    if await db.inventory_items.find_one(
        {"$or": [{"usage_unit_id": uid}, {"purchase_unit_id": uid}]}
    ):
        raise HTTPException(400, "Unit is used by an inventory item")
    await db.units.delete_one({"_id": _oid(uid)})
    return {"ok": True}


# ===================== ITEMS & STOCK =====================
@router.get("/items")
async def list_items(q: Optional[str] = None, user: dict = Depends(get_current_user)):
    units = await _units_map()
    query = {}
    if q:
        query = {"name": {"$regex": q, "$options": "i"}}
    items = await db.inventory_items.find(query).sort("name", 1).to_list(500)
    return [_enrich(i, units) for i in items]


@router.post("/items")
async def create_item(body: InventoryItemIn, user: dict = Depends(get_current_user)):
    _mgr(user)
    units = await _units_map()
    usage = units.get(str(body.usage_unit_id or ""))
    if body.usage_unit_id and not usage:
        raise HTTPException(400, "Usage unit not found")
    doc = body.model_dump()
    doc.pop("opening_stock", None)
    doc["base_kind"] = usage.get("kind") if usage else "count"
    doc["stock_base"] = round(
        _to_base(body.opening_stock, body.usage_unit_id, units), 3
    )
    doc["active"] = True
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.inventory_items.insert_one(doc)
    doc["_id"] = r.inserted_id
    return _enrich(doc, units)


@router.patch("/items/{iid}")
async def update_item(
    iid: str, body: InventoryItemIn, user: dict = Depends(get_current_user)
):
    _mgr(user)
    it = await db.inventory_items.find_one({"_id": _oid(iid)})
    if not it:
        raise HTTPException(404, "Not found")
    units = await _units_map()
    usage = units.get(str(body.usage_unit_id or ""))
    if body.usage_unit_id and not usage:
        raise HTTPException(400, "Usage unit not found")
    doc = body.model_dump()
    doc.pop("opening_stock", None)
    if usage:
        doc["base_kind"] = usage["kind"]
    await db.inventory_items.update_one({"_id": _oid(iid)}, {"$set": doc})
    return _enrich(await db.inventory_items.find_one({"_id": _oid(iid)}), units)


@router.delete("/items/{iid}")
async def delete_item(iid: str, user: dict = Depends(get_current_user)):
    _mgr(user)
    await db.inventory_items.delete_one({"_id": _oid(iid)})
    await db.recipes.update_many({}, {"$pull": {"lines": {"item_id": iid}}})
    await db.recipes.update_many(
        {"direct_item_id": iid}, {"$set": {"direct_item_id": None}}
    )
    return {"ok": True}


@router.post("/items/{iid}/adjust")
async def adjust_stock(
    iid: str, body: StockAdjustIn, user: dict = Depends(get_current_user)
):
    """Manual stock change with a mandatory reason. Every adjustment lands in
    the inventory_movements ledger (who/when/what/why, before→after)."""
    it = await db.inventory_items.find_one({"_id": _oid(iid)})
    if not it:
        raise HTTPException(404, "Not found")
    units = await _units_map()
    before = it.get("stock_base", 0.0) or 0.0
    if body.reason == "stocktake":
        if body.new_stock is None:
            raise HTTPException(400, "new_stock (counted qty) required for stocktake")
        after = _to_base(body.new_stock, it.get("usage_unit_id"), units)
    else:
        if body.qty == 0:
            raise HTTPException(400, "qty must be non-zero")
        after = before + _to_base(body.qty, it.get("usage_unit_id"), units)
    after = round(after, 3)
    await db.inventory_items.update_one(
        {"_id": it["_id"]}, {"$set": {"stock_base": after}}
    )
    movement = {
        "item_id": iid,
        "item_name": it.get("name"),
        "reason": body.reason,
        "note": body.note or "",
        "delta_base": round(after - before, 3),
        "before_base": round(before, 3),
        "after_base": after,
        "user_id": user["id"],
        "user_name": user.get("name") or user.get("email"),
        "order_id": None,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    await db.inventory_movements.insert_one(movement)
    out = _enrich(await db.inventory_items.find_one({"_id": it["_id"]}), units)
    out["movement"] = serialize(movement)
    return out


@router.get("/movements")
async def list_movements(
    item_id: Optional[str] = None,
    limit: int = 200,
    user: dict = Depends(get_current_user),
):
    query = {"item_id": item_id} if item_id else {}
    docs = (
        await db.inventory_movements.find(query).sort("at", -1).to_list(min(limit, 500))
    )
    units = await _units_map()
    items = {str(i["_id"]): i for i in await db.inventory_items.find().to_list(500)}
    out = []
    for d in docs:
        s = serialize(d)
        it = items.get(d.get("item_id") or "")
        usage = units.get(str((it or {}).get("usage_unit_id") or ""))
        f = usage.get("factor_to_base", 1.0) if usage else 1.0
        s["unit_symbol"] = usage.get("symbol") if usage else "base"
        s["delta"] = round(d.get("delta_base", 0) / f, 3)
        s["before"] = round(d.get("before_base", 0) / f, 3)
        s["after"] = round(d.get("after_base", 0) / f, 3)
        out.append(s)
    return out


@router.get("/summary")
async def inventory_summary(user: dict = Depends(get_current_user)):
    units = await _units_map()
    items = await db.inventory_items.find({"active": {"$ne": False}}).to_list(500)
    enriched = [_enrich(i, units) for i in items]
    return {
        "total_items": len(enriched),
        "out_of_stock": sum(1 for e in enriched if e["out_of_stock"]),
        "low_stock": sum(1 for e in enriched if e["low_stock"]),
        "stock_value": round(sum(e["stock_value"] for e in enriched), 2),
    }


# ===================== RECIPES =====================
@router.get("/recipes")
async def list_recipes(user: dict = Depends(get_current_user)):
    units = await _units_map()
    items = {str(i["_id"]): i for i in await db.inventory_items.find().to_list(500)}
    prods = {str(p["_id"]): p for p in await db.products.find().to_list(2000)}
    out = []
    for r in await db.recipes.find().sort("product_id", 1).to_list(500):
        s = serialize(r)
        p = prods.get(r.get("product_id") or "")
        s["product_name"] = p.get("name") if p else "—"
        s["product_variants"] = [v.get("name") for v in (p or {}).get("variants", [])]
        direct = items.get(str(r.get("direct_item_id") or ""))
        s["direct_item_name"] = direct.get("name") if direct else None
        s["lines"] = [
            {
                **line,
                "item_name": (items.get(str(line.get("item_id") or "")) or {}).get(
                    "name", "?"
                ),
                "unit_symbol": (
                    units.get(
                        str(
                            line.get("unit_id")
                            or (items.get(str(line.get("item_id") or "")) or {}).get(
                                "usage_unit_id"
                            )
                            or ""
                        )
                    )
                    or {}
                ).get("symbol"),
            }
            for line in r.get("lines", [])
        ]
        out.append(s)
    return out


@router.get("/recipes/by-product/{pid}")
async def recipe_by_product(pid: str, user: dict = Depends(get_current_user)):
    r = await db.recipes.find_one({"product_id": pid})
    return serialize(r) if r else None


@router.post("/recipes")
async def upsert_recipe(body: RecipeIn, user: dict = Depends(get_current_user)):
    _mgr(user)
    if not body.lines and not body.direct_item_id:
        raise HTTPException(400, "Recipe needs ingredient lines or a direct item")
    doc = body.model_dump()
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    existing = await db.recipes.find_one({"product_id": body.product_id})
    if existing:
        await db.recipes.update_one({"_id": existing["_id"]}, {"$set": doc})
        return serialize(await db.recipes.find_one({"_id": existing["_id"]}))
    doc["created_at"] = doc["updated_at"]
    r = await db.recipes.insert_one(doc)
    doc["_id"] = r.inserted_id
    return serialize(doc)


@router.delete("/recipes/{rid}")
async def delete_recipe(rid: str, user: dict = Depends(get_current_user)):
    _mgr(user)
    await db.recipes.delete_one({"_id": _oid(rid)})
    return {"ok": True}


# ===================== AUTO-DEDUCTION =====================
async def deduct_inventory_for_order(order: dict):
    """Called on payment (alongside keg decrement). For each sold line with a
    recipe: scale by variant multiplier, convert every ingredient to base
    units, deduct, and log a 'sale' movement per item. Best-effort — callers
    wrap in try/except so a stock issue can never block a payment."""
    recipes = {
        r["product_id"]: r
        for r in await db.recipes.find({"active": {"$ne": False}}).to_list(500)
    }
    if not recipes:
        return
    units = await _units_map()
    items = {str(i["_id"]): i for i in await db.inventory_items.find().to_list(500)}
    deltas: dict = {}
    for line in order.get("lines", []):
        r = recipes.get(line.get("product_id"))
        if not r:
            continue
        mult = (r.get("variant_multipliers") or {}).get(line.get("variant") or "", 1.0)
        qty = (line.get("qty") or 1) * (mult or 1.0)
        if r.get("direct_item_id") and r["direct_item_id"] in items:
            it = items[r["direct_item_id"]]
            deltas[it["_id"]] = deltas.get(it["_id"], 0.0) - _to_base(
                qty, it.get("usage_unit_id"), units
            )
        for rl in r.get("lines", []):
            iid = rl.get("item_id")
            it = items.get(iid)
            if not it:
                continue
            deltas[iid] = deltas.get(iid, 0.0) - _to_base(
                qty * rl.get("qty", 0.0),
                rl.get("unit_id") or it.get("usage_unit_id"),
                units,
            )
    if not deltas:
        return
    now = datetime.now(timezone.utc).isoformat()
    server_name = None
    if order.get("server_id"):
        try:
            srv = await db.users.find_one({"_id": _oid(order["server_id"])})
            server_name = (srv or {}).get("name")
        except Exception:
            server_name = None
    movements = []
    for iid, delta in deltas.items():
        it = items[iid]
        before = it.get("stock_base", 0.0) or 0.0
        after = round(before + delta, 3)
        await db.inventory_items.update_one(
            {"_id": it["_id"]}, {"$set": {"stock_base": after}}
        )
        movements.append(
            {
                "item_id": iid,
                "item_name": it.get("name"),
                "reason": "sale",
                "note": f"Order #{str(order.get('_id', ''))[-6:]}",
                "delta_base": round(delta, 3),
                "before_base": round(before, 3),
                "after_base": after,
                "user_id": order.get("server_id"),
                "user_name": server_name,
                "order_id": str(order.get("_id")),
                "at": now,
            }
        )
    await db.inventory_movements.insert_many(movements)
