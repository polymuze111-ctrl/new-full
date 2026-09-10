"""Iter 29: Inventory module full backend test suite.

Covers: units CRUD + duplicate guard, items CRUD, stock adjustments (restock/waste/
stocktake), movement ledger, recipes CRUD, auto-deduction on order pay (incl.
variant multiplier x2), role gating for server user.
"""
import os
import time

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
UA = {"User-Agent": "Mozilla/5.0"}
ADMIN = ("polymuze111@gmail.com", "admin123")
SERVER = ("server@hkbar.com", "server123")


def _login(email, pw):
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": email, "password": pw},
        headers=UA,
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_h():
    t = _login(*ADMIN)
    return {"Authorization": f"Bearer {t}", **UA}


@pytest.fixture(scope="module")
def server_h():
    t = _login(*SERVER)
    return {"Authorization": f"Bearer {t}", **UA}


# ---------- UNITS ----------
class TestUnits:
    def test_list_units_seeded(self, admin_h):
        r = requests.get(f"{BASE}/api/inventory/units", headers=admin_h, timeout=20)
        assert r.status_code == 200
        units = r.json()
        syms = {u["symbol"] for u in units}
        # 15 seeded per seed_inventory.py
        for s in ("ml", "cl", "l", "g", "kg", "bottle", "pint", "keg", "pour"):
            assert s in syms, f"missing seed unit {s}"
        assert len(units) >= 15

    def test_create_and_delete_custom_unit(self, admin_h):
        # cleanup if left over
        payload = {
            "name": "TEST Case 12x750",
            "symbol": "test_case12",
            "kind": "volume",
            "factor_to_base": 9000,
        }
        r = requests.post(
            f"{BASE}/api/inventory/units", json=payload, headers=admin_h, timeout=20
        )
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        assert r.json()["symbol"] == "test_case12"
        assert r.json()["custom"] is True
        # duplicate symbol -> 400
        r2 = requests.post(
            f"{BASE}/api/inventory/units", json=payload, headers=admin_h, timeout=20
        )
        assert r2.status_code == 400
        # cleanup
        d = requests.delete(
            f"{BASE}/api/inventory/units/{uid}", headers=admin_h, timeout=20
        )
        assert d.status_code == 200

    def test_duplicate_seed_ml_rejected(self, admin_h):
        r = requests.post(
            f"{BASE}/api/inventory/units",
            json={"name": "dup ml", "symbol": "ml", "kind": "volume", "factor_to_base": 1},
            headers=admin_h,
            timeout=20,
        )
        assert r.status_code == 400


# ---------- ITEMS ----------
class TestItems:
    def test_list_seeded_items(self, admin_h):
        r = requests.get(f"{BASE}/api/inventory/items", headers=admin_h, timeout=20)
        assert r.status_code == 200
        items = r.json()
        names = {i["name"] for i in items}
        assert "Bourbon Whiskey" in names
        assert len(items) >= 12
        b = next(i for i in items if i["name"] == "Bourbon Whiskey")
        assert b["usage_unit_symbol"] == "ml"
        assert b["purchase_unit_symbol"] == "bottle"

    def test_summary(self, admin_h):
        r = requests.get(f"{BASE}/api/inventory/summary", headers=admin_h, timeout=20)
        assert r.status_code == 200
        s = r.json()
        assert s["total_items"] >= 12
        assert isinstance(s["stock_value"], (int, float))

    def test_item_create_update_delete(self, admin_h):
        units = requests.get(
            f"{BASE}/api/inventory/units", headers=admin_h, timeout=20
        ).json()
        bottle = next(u for u in units if u["symbol"] == "bottle")["id"]
        ml = next(u for u in units if u["symbol"] == "ml")["id"]
        create = {
            "name": "TEST Tonic",
            "sku": "",
            "category": "Grocery",
            "purchase_unit_id": bottle,
            "usage_unit_id": ml,
            "cost_per_purchase_unit": 100,
            "opening_stock": 1400,
            "par_level": 2000,
            "reorder_level": 500,
        }
        r = requests.post(
            f"{BASE}/api/inventory/items", json=create, headers=admin_h, timeout=20
        )
        assert r.status_code == 200, r.text
        item = r.json()
        iid = item["id"]
        assert item["stock"] == 1400  # 1400 ml in ml base
        assert item["usage_unit_symbol"] == "ml"

        # update par
        upd = {**create, "par_level": 3000}
        r2 = requests.patch(
            f"{BASE}/api/inventory/items/{iid}",
            json=upd,
            headers=admin_h,
            timeout=20,
        )
        assert r2.status_code == 200
        assert r2.json()["par_level"] == 3000

        # delete
        d = requests.delete(
            f"{BASE}/api/inventory/items/{iid}", headers=admin_h, timeout=20
        )
        assert d.status_code == 200


# ---------- ADJUSTMENTS ----------
def _get_item(admin_h, name):
    items = requests.get(
        f"{BASE}/api/inventory/items", headers=admin_h, timeout=20
    ).json()
    return next(i for i in items if i["name"] == name)


class TestAdjustments:
    def test_restock_waste_stocktake_flow(self, admin_h):
        # pick Lime Juice (5000ml seeded) to avoid interfering with auto-deduct tests
        it = _get_item(admin_h, "Lime Juice")
        iid = it["id"]
        start = it["stock"]

        # restock +700
        r = requests.post(
            f"{BASE}/api/inventory/items/{iid}/adjust",
            json={"qty": 700, "reason": "restock", "note": "TEST restock"},
            headers=admin_h,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        after = r.json()["stock"]
        assert abs(after - (start + 700)) < 0.01, f"{after} vs {start+700}"
        assert r.json()["movement"]["reason"] == "restock"

        # waste -100 (negative qty)
        r2 = requests.post(
            f"{BASE}/api/inventory/items/{iid}/adjust",
            json={"qty": -100, "reason": "waste", "note": "TEST waste"},
            headers=admin_h,
            timeout=20,
        )
        assert r2.status_code == 200
        assert abs(r2.json()["stock"] - (after - 100)) < 0.01

        # stocktake absolute 4321
        r3 = requests.post(
            f"{BASE}/api/inventory/items/{iid}/adjust",
            json={"qty": 0, "reason": "stocktake", "new_stock": 4321,
                  "note": "TEST count"},
            headers=admin_h,
            timeout=20,
        )
        assert r3.status_code == 200
        assert abs(r3.json()["stock"] - 4321) < 0.01

        # movements list has our TEST_ entries
        m = requests.get(
            f"{BASE}/api/inventory/movements?item_id={iid}",
            headers=admin_h,
            timeout=20,
        )
        assert m.status_code == 200
        reasons = [x["reason"] for x in m.json()[:3]]
        assert "stocktake" in reasons and "waste" in reasons and "restock" in reasons
        top = m.json()[0]
        assert top["unit_symbol"] == "ml"
        assert top["user_name"]

    def test_stocktake_requires_new_stock(self, admin_h):
        it = _get_item(admin_h, "Lime Juice")
        r = requests.post(
            f"{BASE}/api/inventory/items/{it['id']}/adjust",
            json={"qty": 0, "reason": "stocktake"},
            headers=admin_h,
            timeout=20,
        )
        assert r.status_code == 400

    def test_zero_qty_non_stocktake_rejected(self, admin_h):
        it = _get_item(admin_h, "Lime Juice")
        r = requests.post(
            f"{BASE}/api/inventory/items/{it['id']}/adjust",
            json={"qty": 0, "reason": "restock"},
            headers=admin_h,
            timeout=20,
        )
        assert r.status_code == 400


# ---------- RECIPES ----------
class TestRecipes:
    def test_list_seeded_recipes(self, admin_h):
        r = requests.get(f"{BASE}/api/inventory/recipes", headers=admin_h, timeout=20)
        assert r.status_code == 200
        recs = r.json()
        names = {rec.get("product_name") for rec in recs}
        assert "Hong Kong Sour" in names
        hks = next(rec for rec in recs if rec["product_name"] == "Hong Kong Sour")
        assert len(hks["lines"]) == 3
        assert hks["variant_multipliers"].get("Double") == 2.0


# ---------- AUTO-DEDUCTION E2E ----------
def _find_product(admin_h, name):
    r = requests.get(f"{BASE}/api/products", headers=admin_h, timeout=20)
    assert r.status_code == 200
    return next((p for p in r.json() if p["name"] == name), None)


class TestAutoDeduction:
    def test_old_fashioned_deducts_bourbon_50ml(self, admin_h):
        prod = _find_product(admin_h, "Old Fashioned")
        assert prod, "Old Fashioned product missing"
        bourbon_before = _get_item(admin_h, "Bourbon Whiskey")["stock"]

        # create order
        line = {
            "product_id": prod["id"],
            "name": prod["name"],
            "price": prod["price"],
            "qty": 1,
            "course": "drink",
        }
        order = requests.post(
            f"{BASE}/api/orders",
            json={"order_type": "pick_up", "lines": [line], "service_charge_pct": 0},
            headers=admin_h,
            timeout=20,
        )
        assert order.status_code == 200, order.text
        oid = order.json()["id"]
        total = order.json()["total"]

        # pay
        pay = requests.post(
            f"{BASE}/api/orders/{oid}/pay",
            json={"method": "cash", "amount": total, "tip": 0, "splits": []},
            headers=admin_h,
            timeout=20,
        )
        assert pay.status_code == 200
        time.sleep(0.5)

        bourbon_after = _get_item(admin_h, "Bourbon Whiskey")["stock"]
        delta = round(bourbon_before - bourbon_after, 3)
        assert abs(delta - 50.0) < 0.5, (
            f"Bourbon delta {delta}ml (expected 50)"
        )

        # movement with reason=sale + order_id
        m = requests.get(
            f"{BASE}/api/inventory/movements?limit=50", headers=admin_h, timeout=20
        ).json()
        bourbon_moves = [
            x for x in m
            if x["item_name"] == "Bourbon Whiskey" and x.get("order_id") == oid
        ]
        assert bourbon_moves, "no sale movement logged for order"
        assert bourbon_moves[0]["reason"] == "sale"
        assert abs(bourbon_moves[0]["delta"] + 50.0) < 0.5

    def test_double_variant_scales_2x(self, admin_h):
        prod = _find_product(admin_h, "Hong Kong Sour")
        assert prod, "Hong Kong Sour product missing"
        bourbon_before = _get_item(admin_h, "Bourbon Whiskey")["stock"]

        line = {
            "product_id": prod["id"],
            "name": prod["name"],
            "price": prod["price"],
            "qty": 1,
            "variant": "Double",
            "course": "drink",
        }
        order = requests.post(
            f"{BASE}/api/orders",
            json={"order_type": "pick_up", "lines": [line], "service_charge_pct": 0},
            headers=admin_h,
            timeout=20,
        )
        assert order.status_code == 200
        oid = order.json()["id"]
        total = order.json()["total"]
        pay = requests.post(
            f"{BASE}/api/orders/{oid}/pay",
            json={"method": "cash", "amount": total, "tip": 0, "splits": []},
            headers=admin_h,
            timeout=20,
        )
        assert pay.status_code == 200
        time.sleep(0.5)
        bourbon_after = _get_item(admin_h, "Bourbon Whiskey")["stock"]
        delta = round(bourbon_before - bourbon_after, 3)
        # HK Sour uses 50ml bourbon x Double(2) = 100ml
        assert abs(delta - 100.0) < 0.5, f"Double variant delta {delta}ml expected 100"


# ---------- ROLE GATING ----------
class TestRoleGating:
    def test_server_cannot_create_unit(self, server_h):
        r = requests.post(
            f"{BASE}/api/inventory/units",
            json={"name": "TEST srv", "symbol": "test_srv_sym",
                  "kind": "volume", "factor_to_base": 1},
            headers=server_h,
            timeout=20,
        )
        assert r.status_code == 403

    def test_server_cannot_create_item(self, server_h, admin_h):
        units = requests.get(
            f"{BASE}/api/inventory/units", headers=admin_h, timeout=20
        ).json()
        bottle = next(u for u in units if u["symbol"] == "bottle")["id"]
        r = requests.post(
            f"{BASE}/api/inventory/items",
            json={"name": "TEST srv item", "purchase_unit_id": bottle,
                  "usage_unit_id": bottle, "cost_per_purchase_unit": 1,
                  "opening_stock": 1},
            headers=server_h,
            timeout=20,
        )
        assert r.status_code == 403

    def test_server_can_view_stock(self, server_h):
        r = requests.get(f"{BASE}/api/inventory/items", headers=server_h, timeout=20)
        assert r.status_code == 200

    def test_server_can_adjust_stock(self, server_h, admin_h):
        # adjust an item that isn't in any recipe (avoid interfering with dedupe tests)
        it = _get_item(admin_h, "Chicken Wings (raw)")
        r = requests.post(
            f"{BASE}/api/inventory/items/{it['id']}/adjust",
            json={"qty": -10, "reason": "waste", "note": "TEST server waste"},
            headers=server_h,
            timeout=20,
        )
        assert r.status_code == 200
