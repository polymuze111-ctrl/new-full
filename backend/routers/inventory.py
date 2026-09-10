"""Inventory router — measurement units DB, stock items, recipes, movement
ledger, and pay-time auto-deduction. Stock is always stored in BASE units
(ml for volume, g for mass, unit for count) so units stay freely editable."""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from auth import make_current_user_dep
from deps import _oid, db, serialize, sl
from models import (
    InventoryItemIn,
    PurchaseOrderIn,
    RecipeIn,
    StockAdjustIn,
    StocktakeCountIn,
    UnitIn,
)

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
        # Normalise sign by reason so API and UI can't disagree
        qty = abs(body.qty)
        if body.reason in ("waste", "breakage"):
            qty = -qty
        after = before + _to_base(qty, it.get("usage_unit_id"), units)
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
    await _sync_86_flag()
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


def _recipe_line_view(line: dict, items: dict, units: dict) -> dict:
    it = items.get(str(line.get("item_id") or "")) or {}
    unit = units.get(str(line.get("unit_id") or it.get("usage_unit_id") or "")) or {}
    return {**line, "item_name": it.get("name", "?"), "unit_symbol": unit.get("symbol")}


def _enrich_recipe(r: dict, prods: dict, items: dict, units: dict) -> dict:
    s = serialize(r)
    p = prods.get(r.get("product_id") or "")
    s["product_name"] = p.get("name") if p else "—"
    s["product_variants"] = [v.get("name") for v in (p or {}).get("variants", [])]
    direct = items.get(str(r.get("direct_item_id") or ""))
    s["direct_item_name"] = direct.get("name") if direct else None
    s["lines"] = [_recipe_line_view(line, items, units) for line in r.get("lines", [])]
    return s


@router.get("/recipes")
async def list_recipes(user: dict = Depends(get_current_user)):
    units = await _units_map()
    items = {str(i["_id"]): i for i in await db.inventory_items.find().to_list(500)}
    prods = {str(p["_id"]): p for p in await db.products.find().to_list(2000)}
    recipes = await db.recipes.find().sort("product_id", 1).to_list(500)
    return [_enrich_recipe(r, prods, items, units) for r in recipes]


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
def _compute_order_deltas(order: dict, recipes: dict, units: dict, items: dict) -> dict:
    """Map item_id -> signed base-unit delta for every recipe-linked line.
    Variant multipliers scale the whole recipe (e.g. Double ×2)."""
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
    return deltas


async def _apply_inventory_deltas(deltas: dict, items: dict, order: dict):
    """Apply signed deltas to stock, log one 'sale' movement per item, resync 86 flags."""
    now = datetime.now(timezone.utc).isoformat()
    server_name = None
    if order.get("server_id"):
        try:
            srv = await db.users.find_one({"_id": _oid(order["server_id"])})
            server_name = srv.get("name") if isinstance(srv, dict) else None
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
    await _sync_86_flag()


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
    deltas = _compute_order_deltas(order, recipes, units, items)
    if not deltas:
        return
    await _apply_inventory_deltas(deltas, items, order)


# ===================== AUTO-86 SYNC =====================
async def _sync_86_flag():
    """Auto-86: a product is 86'd when any recipe ingredient (or its direct
    sell-as-is item) sits at zero stock, and un-86'd once everything is back.
    Note: this manages is_86d for recipe-linked products only."""
    recipes = await db.recipes.find({"active": {"$ne": False}}).to_list(500)
    if not recipes:
        return
    items = {str(i["_id"]): i for i in await db.inventory_items.find().to_list(500)}
    for r in recipes:
        pid = r.get("product_id")
        if not pid:
            continue
        ids = [rl.get("item_id") for rl in r.get("lines", [])]
        if r.get("direct_item_id"):
            ids.append(r["direct_item_id"])
        zero = any(
            (items.get(i) or {}).get("stock_base", 1) <= 0
            for i in ids
            if i and i in items
        )
        try:
            await db.products.update_one(
                {"_id": _oid(pid)}, {"$set": {"is_86d": bool(zero)}}
            )
        except Exception:
            pass


async def adjust_item_base(
    item_id, delta_base, reason, note="", user=None, order_id=None
):
    """Shared stock mutation: apply delta (base units), log a movement, resync 86 flags."""
    try:
        it = await db.inventory_items.find_one({"_id": _oid(item_id)})
    except Exception:
        return None
    if not it:
        return None
    before = it.get("stock_base", 0.0) or 0.0
    after = round(before + delta_base, 3)
    await db.inventory_items.update_one(
        {"_id": it["_id"]}, {"$set": {"stock_base": after}}
    )
    await db.inventory_movements.insert_one(
        {
            "item_id": item_id,
            "item_name": it.get("name"),
            "reason": reason,
            "note": note,
            "delta_base": round(delta_base, 3),
            "before_base": round(before, 3),
            "after_base": after,
            "user_id": (user or {}).get("id"),
            "user_name": (user or {}).get("name"),
            "order_id": order_id,
            "at": datetime.now(timezone.utc).isoformat(),
        }
    )
    await _sync_86_flag()
    return after


# ===================== PURCHASE ORDERS (receiving) =====================
@router.get("/purchase-orders")
async def list_purchase_orders(user: dict = Depends(get_current_user)):
    units = await _units_map()
    items = {str(i["_id"]): i for i in await db.inventory_items.find().to_list(500)}
    out = []
    for p in await db.purchase_orders.find().sort("created_at", -1).to_list(200):
        s = serialize(p)
        for line in s.get("lines", []):
            it = items.get(line.get("item_id") or "") or {}
            line["item_name"] = it.get("name", "?")
            pu = units.get(str(it.get("purchase_unit_id") or ""))
            line["unit_symbol"] = (pu or {}).get("symbol")
        s["total_cost"] = round(
            sum(
                line.get("qty", 0) * line.get("unit_cost", 0)
                for line in s.get("lines", [])
            ),
            2,
        )
        out.append(s)
    return out


@router.post("/purchase-orders")
async def create_purchase_order(
    body: PurchaseOrderIn, user: dict = Depends(get_current_user)
):
    _mgr(user)
    if not body.lines:
        raise HTTPException(400, "Add at least one line")
    doc = body.model_dump()
    doc.update(
        {
            "status": "open",
            "created_by": user.get("name") or user.get("email"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    r = await db.purchase_orders.insert_one(doc)
    doc["_id"] = r.inserted_id
    return serialize(doc)


@router.post("/purchase-orders/{poid}/receive")
async def receive_purchase_order(poid: str, user: dict = Depends(get_current_user)):
    """Receiving a PO restocks every line (purchase units → base units) and
    logs a restock movement per item."""
    _mgr(user)
    po = await db.purchase_orders.find_one({"_id": _oid(poid)})
    if not po:
        raise HTTPException(404, "Not found")
    if po.get("status") != "open":
        raise HTTPException(400, "PO already received or cancelled")
    units = await _units_map()
    items = {str(i["_id"]): i for i in await db.inventory_items.find().to_list(500)}
    tag = f"PO #{str(po['_id'])[-6:]}"
    for line in po.get("lines", []):
        it = items.get(line.get("item_id") or "")
        if not it:
            continue
        pu = units.get(str(it.get("purchase_unit_id") or ""))
        factor = (pu or {}).get("factor_to_base", 1.0)
        await adjust_item_base(
            str(it["_id"]),
            line.get("qty", 0) * factor,
            "restock",
            f"{tag} received",
            user=user,
        )
    await db.purchase_orders.update_one(
        {"_id": po["_id"]},
        {
            "$set": {
                "status": "received",
                "received_at": datetime.now(timezone.utc).isoformat(),
                "received_by": user.get("name") or user.get("email"),
            }
        },
    )
    return serialize(await db.purchase_orders.find_one({"_id": po["_id"]}))


@router.post("/purchase-orders/{poid}/cancel")
async def cancel_purchase_order(poid: str, user: dict = Depends(get_current_user)):
    _mgr(user)
    po = await db.purchase_orders.find_one({"_id": _oid(poid)})
    if not po:
        raise HTTPException(404, "Not found")
    if po.get("status") != "open":
        raise HTTPException(400, "Only open POs can be cancelled")
    await db.purchase_orders.update_one(
        {"_id": po["_id"]}, {"$set": {"status": "cancelled"}}
    )
    return serialize(await db.purchase_orders.find_one({"_id": po["_id"]}))


# ===================== STOCKTAKE SESSIONS =====================
@router.post("/stocktake/start")
async def stocktake_start(user: dict = Depends(get_current_user)):
    _mgr(user)
    if await db.stocktakes.find_one({"status": "open"}):
        raise HTTPException(400, "A stocktake session is already open")
    items = await db.inventory_items.find({"active": {"$ne": False}}).to_list(500)
    doc = {
        "status": "open",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "started_by": user.get("name") or user.get("email"),
        "expected": {str(i["_id"]): i.get("stock_base", 0.0) or 0.0 for i in items},
        "counts": {},
    }
    r = await db.stocktakes.insert_one(doc)
    doc["_id"] = r.inserted_id
    return serialize(doc)


@router.get("/stocktake/current")
async def stocktake_current(user: dict = Depends(get_current_user)):
    st = await db.stocktakes.find_one({"status": "open"})
    if not st:
        return None
    units = await _units_map()
    items = (
        await db.inventory_items.find({"active": {"$ne": False}})
        .sort("name", 1)
        .to_list(500)
    )
    lines = []
    for it in items:
        iid = str(it["_id"])
        usage = units.get(str(it.get("usage_unit_id") or ""))
        f = (usage or {}).get("factor_to_base", 1.0)
        lines.append(
            {
                "item_id": iid,
                "name": it.get("name"),
                "category": it.get("category"),
                "unit_symbol": (usage or {}).get("symbol"),
                "expected": round(st.get("expected", {}).get(iid, 0.0) / f, 3),
                "counted": st.get("counts", {}).get(iid),
            }
        )
    return {"session": serialize(st), "lines": lines}


@router.post("/stocktake/count")
async def stocktake_count(
    body: StocktakeCountIn, user: dict = Depends(get_current_user)
):
    st = await db.stocktakes.find_one({"status": "open"})
    if not st:
        raise HTTPException(400, "No open stocktake session")
    await db.stocktakes.update_one(
        {"_id": st["_id"]}, {"$set": {f"counts.{body.item_id}": body.counted}}
    )
    return {"ok": True}


async def _apply_stocktake_count(
    st: dict, it: dict, counted: float, units: dict, user: dict
) -> dict:
    """Set one item to its counted value, log the stocktake movement, and
    return the variance report line."""
    iid = str(it["_id"])
    usage = units.get(str(it.get("usage_unit_id") or ""))
    uf = (usage or {}).get("factor_to_base", 1.0)
    counted_base = round(_to_base(counted, it.get("usage_unit_id"), units), 3)
    before = it.get("stock_base", 0.0) or 0.0
    expected_base = st.get("expected", {}).get(iid, before)
    variance = round(counted_base - expected_base, 3)
    await db.inventory_items.update_one(
        {"_id": it["_id"]}, {"$set": {"stock_base": counted_base}}
    )
    await db.inventory_movements.insert_one(
        {
            "item_id": iid,
            "item_name": it.get("name"),
            "reason": "stocktake",
            "note": "Stocktake session",
            "delta_base": round(counted_base - before, 3),
            "before_base": round(before, 3),
            "after_base": counted_base,
            "user_id": user["id"],
            "user_name": user.get("name") or user.get("email"),
            "order_id": None,
            "at": datetime.now(timezone.utc).isoformat(),
        }
    )
    pu = units.get(str(it.get("purchase_unit_id") or ""))
    pf = (pu or {}).get("factor_to_base", 1.0)
    return {
        "item_id": iid,
        "name": it.get("name"),
        "unit_symbol": (usage or {}).get("symbol"),
        "expected": round(expected_base / uf, 3),
        "counted": counted,
        "variance": round(variance / uf, 3),
        "variance_value": (
            round((variance / pf) * it.get("cost_per_purchase_unit", 0.0), 2)
            if pf
            else 0.0
        ),
    }


@router.post("/stocktake/close")
async def stocktake_close(user: dict = Depends(get_current_user)):
    """Close the session: counted items are set to the counted value, each
    correction lands in the movement ledger, and a variance report (with HKD
    value) is returned and stored on the session."""
    _mgr(user)
    st = await db.stocktakes.find_one({"status": "open"})
    if not st:
        raise HTTPException(400, "No open stocktake session")
    units = await _units_map()
    items = {str(i["_id"]): i for i in await db.inventory_items.find().to_list(500)}
    report = []
    for iid, counted in (st.get("counts") or {}).items():
        it = items.get(iid)
        if it:
            report.append(await _apply_stocktake_count(st, it, counted, units, user))
    report.sort(key=lambda r: -abs(r["variance_value"]))
    await db.stocktakes.update_one(
        {"_id": st["_id"]},
        {
            "$set": {
                "status": "closed",
                "closed_at": datetime.now(timezone.utc).isoformat(),
                "closed_by": user.get("name") or user.get("email"),
                "report": report,
            }
        },
    )
    await _sync_86_flag()
    return {
        "report": report,
        "session": serialize(await db.stocktakes.find_one({"_id": st["_id"]})),
    }


@router.post("/stocktake/cancel")
async def stocktake_cancel(user: dict = Depends(get_current_user)):
    _mgr(user)
    await db.stocktakes.update_many(
        {"status": "open"}, {"$set": {"status": "cancelled"}}
    )
    return {"ok": True}


@router.get("/stocktake/history")
async def stocktake_history(user: dict = Depends(get_current_user)):
    docs = (
        await db.stocktakes.find({"status": "closed"}).sort("closed_at", -1).to_list(20)
    )
    return sl(docs)


# ===================== ANALYTICS =====================
def _aggregate_movement_totals(movs: list) -> dict:
    """item_id -> {sold, waste, restock} in base units (sold/waste positive)."""
    agg: dict = {}
    for m in movs:
        a = agg.setdefault(
            m.get("item_id") or "", {"sold": 0.0, "waste": 0.0, "restock": 0.0}
        )
        d = m.get("delta_base", 0.0) or 0.0
        if m.get("reason") == "sale":
            a["sold"] += -d
        elif m.get("reason") in ("waste", "breakage"):
            a["waste"] += -d
        elif m.get("reason") == "restock":
            a["restock"] += d
    return agg


def _analytics_row(item: dict, a: dict, units: dict, days: int) -> dict:
    usage = units.get(str(item.get("usage_unit_id") or ""))
    uf = (usage or {}).get("factor_to_base", 1.0)
    pu = units.get(str(item.get("purchase_unit_id") or ""))
    pf = (pu or {}).get("factor_to_base", 1.0)
    cost = item.get("cost_per_purchase_unit", 0.0) or 0.0
    velocity = a["sold"] / days  # base units per day
    stock_base = item.get("stock_base", 0.0) or 0.0
    return {
        "item_id": str(item["_id"]),
        "name": item.get("name"),
        "category": item.get("category"),
        "unit_symbol": (usage or {}).get("symbol"),
        "sold": round(a["sold"] / uf, 2),
        "waste": round(a["waste"] / uf, 2),
        "restocked": round(a["restock"] / uf, 2),
        "usage_value": round((a["sold"] / pf) * cost, 2) if pf else 0.0,
        "waste_value": round((a["waste"] / pf) * cost, 2) if pf else 0.0,
        "days_of_stock": round(stock_base / velocity, 1) if velocity > 0 else None,
    }


@router.get("/analytics")
async def inventory_analytics(days: int = 30, user: dict = Depends(get_current_user)):
    """Usage velocity, waste cost and days-of-stock per item over N days."""
    days = max(1, min(days, 90))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    movs = await db.inventory_movements.find({"at": {"$gte": since}}).to_list(20000)
    units = await _units_map()
    items = {str(i["_id"]): i for i in await db.inventory_items.find().to_list(500)}
    agg = _aggregate_movement_totals(movs)
    rows = [
        _analytics_row(
            it, agg.get(iid, {"sold": 0.0, "waste": 0.0, "restock": 0.0}), units, days
        )
        for iid, it in items.items()
    ]
    rows.sort(key=lambda r: -r["usage_value"])
    return {
        "days": days,
        "rows": rows,
        "totals": {
            "usage_value": round(sum(r["usage_value"] for r in rows), 2),
            "waste_value": round(sum(r["waste_value"] for r in rows), 2),
            "restock_count": sum(1 for m in movs if m.get("reason") == "restock"),
        },
    }
