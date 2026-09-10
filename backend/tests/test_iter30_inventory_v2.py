"""Iter 30: Inventory v2 — auto-86, purchase orders, stocktake sessions,
analytics, and keg↔inventory bridge.

Run: REACT_APP_BACKEND_URL=<url> pytest backend/tests/test_iter30_inventory_v2.py -n 0
"""

import os
import time

import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
UA = {"User-Agent": "Mozilla/5.0"}
ADMIN = ("polymuze111@gmail.com", "admin123")


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


def _get_item(admin_h, name):
    items = requests.get(f"{BASE}/api/inventory/items", headers=admin_h, timeout=20).json()
    return next((i for i in items if i["name"] == name), None)


def _get_product(admin_h, name):
    prods = requests.get(f"{BASE}/api/products", headers=admin_h, timeout=20).json()
    return next((p for p in prods if p["name"] == name), None)


# =========================================================
# 1. AUTO-86: waste-out an ingredient → product becomes 86'd
# =========================================================
class TestAuto86:
    def test_waste_out_angostura_86s_old_fashioned(self, admin_h):
        ango = _get_item(admin_h, "Angostura Bitters")
        assert ango, "Angostura seeded item missing"
        of = _get_product(admin_h, "Old Fashioned")
        assert of, "Old Fashioned product missing"
        start = ango["stock"]

        # waste ALL the stock (send positive qty; sign normalisation forces subtract)
        r = requests.post(
            f"{BASE}/api/inventory/items/{ango['id']}/adjust",
            json={"qty": start, "reason": "waste", "note": "TEST_iter30 wipe"},
            headers=admin_h,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        # sign normalisation → delta must be negative
        assert r.json()["stock"] <= 0.01, f"stock still {r.json()['stock']}"
        assert r.json()["movement"]["delta_base"] < 0, "waste must produce negative movement"

        time.sleep(0.3)
        of2 = _get_product(admin_h, "Old Fashioned")
        assert of2.get("is_86d") is True, "Old Fashioned should auto-86 with zero Angostura"

        # restock 700ml → un-86
        r2 = requests.post(
            f"{BASE}/api/inventory/items/{ango['id']}/adjust",
            json={"qty": 700, "reason": "restock", "note": "TEST_iter30 back"},
            headers=admin_h,
            timeout=20,
        )
        assert r2.status_code == 200
        assert r2.json()["stock"] >= 700 - 0.5
        assert r2.json()["movement"]["delta_base"] > 0, "restock must produce positive movement"

        time.sleep(0.3)
        of3 = _get_product(admin_h, "Old Fashioned")
        assert of3.get("is_86d") is False, "Old Fashioned should un-86 after restock"

    def test_waste_negative_qty_also_subtracts(self, admin_h):
        """Both positive and negative qty with reason=waste should subtract (sign normalisation)."""
        lime = _get_item(admin_h, "Lime Juice")
        start = lime["stock"]
        r = requests.post(
            f"{BASE}/api/inventory/items/{lime['id']}/adjust",
            json={"qty": -30, "reason": "waste", "note": "TEST_iter30 neg-waste"},
            headers=admin_h,
            timeout=20,
        )
        assert r.status_code == 200
        assert abs(r.json()["stock"] - (start - 30)) < 0.5


# =========================================================
# 2. PURCHASE ORDERS
# =========================================================
class TestPurchaseOrders:
    def test_create_receive_flow(self, admin_h):
        bourbon = _get_item(admin_h, "Bourbon Whiskey")
        lime = _get_item(admin_h, "Lime Juice")
        assert bourbon and lime
        bourbon_before = bourbon["stock"]
        lime_before = lime["stock"]

        po_body = {
            "supplier": "TEST_iter30 Supplier",
            "lines": [
                {"item_id": bourbon["id"], "qty": 2, "unit_cost": 320},
                {"item_id": lime["id"], "qty": 1, "unit_cost": 45},
            ],
            "notes": "TEST_iter30",
        }
        r = requests.post(
            f"{BASE}/api/inventory/purchase-orders",
            json=po_body,
            headers=admin_h,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        po = r.json()
        pid = po["id"]
        assert po["status"] == "open"

        # list — total should be 685
        lst = requests.get(f"{BASE}/api/inventory/purchase-orders", headers=admin_h, timeout=20).json()
        mine = next((p for p in lst if p["id"] == pid), None)
        assert mine, "created PO missing from list"
        assert abs(mine["total_cost"] - 685.0) < 0.01, f"total={mine['total_cost']}"

        # receive
        rcv = requests.post(
            f"{BASE}/api/inventory/purchase-orders/{pid}/receive",
            headers=admin_h,
            timeout=20,
        )
        assert rcv.status_code == 200, rcv.text
        assert rcv.json()["status"] == "received"

        # bourbon: 2 bottles × 700ml (purchase-unit factor) = +1400ml
        b_after = _get_item(admin_h, "Bourbon Whiskey")["stock"]
        assert abs((b_after - bourbon_before) - 1400) < 1.0, f"bourbon delta {b_after - bourbon_before}"
        # lime: 1 l = +1000ml
        l_after = _get_item(admin_h, "Lime Juice")["stock"]
        assert abs((l_after - lime_before) - 1000) < 1.0, f"lime delta {l_after - lime_before}"

        # movements: restock with note PO #...
        m = requests.get(f"{BASE}/api/inventory/movements?limit=50", headers=admin_h, timeout=20).json()
        po_moves = [x for x in m if "PO #" in (x.get("note") or "") and x["reason"] == "restock"]
        assert len(po_moves) >= 2, f"expected 2 PO restock movements, got {len(po_moves)}"

        # second receive → 400
        rcv2 = requests.post(
            f"{BASE}/api/inventory/purchase-orders/{pid}/receive",
            headers=admin_h,
            timeout=20,
        )
        assert rcv2.status_code == 400

    def test_cancel_po(self, admin_h):
        lime = _get_item(admin_h, "Lime Juice")
        po_body = {
            "supplier": "TEST_iter30 Cancel",
            "lines": [{"item_id": lime["id"], "qty": 1, "unit_cost": 45}],
        }
        r = requests.post(
            f"{BASE}/api/inventory/purchase-orders",
            json=po_body,
            headers=admin_h,
            timeout=20,
        )
        assert r.status_code == 200
        pid = r.json()["id"]
        c = requests.post(
            f"{BASE}/api/inventory/purchase-orders/{pid}/cancel",
            headers=admin_h,
            timeout=20,
        )
        assert c.status_code == 200
        assert c.json()["status"] == "cancelled"
        # cannot receive cancelled
        rcv = requests.post(
            f"{BASE}/api/inventory/purchase-orders/{pid}/receive",
            headers=admin_h,
            timeout=20,
        )
        assert rcv.status_code == 400

    def test_empty_lines_rejected(self, admin_h):
        r = requests.post(
            f"{BASE}/api/inventory/purchase-orders",
            json={"supplier": "X", "lines": []},
            headers=admin_h,
            timeout=20,
        )
        assert r.status_code == 400


# =========================================================
# 3. STOCKTAKE SESSIONS
# =========================================================
class TestStocktakeSession:
    def test_full_flow(self, admin_h):
        # Ensure nothing open (from a prior partial run)
        cur = requests.get(f"{BASE}/api/inventory/stocktake/current", headers=admin_h, timeout=20).json()
        if cur:
            requests.post(f"{BASE}/api/inventory/stocktake/cancel", headers=admin_h, timeout=20)

        # start
        s = requests.post(f"{BASE}/api/inventory/stocktake/start", headers=admin_h, timeout=20)
        assert s.status_code == 200, s.text
        assert s.json()["status"] == "open"

        # cannot start a second
        s2 = requests.post(f"{BASE}/api/inventory/stocktake/start", headers=admin_h, timeout=20)
        assert s2.status_code == 400

        # current — expected present, counted None
        cur = requests.get(f"{BASE}/api/inventory/stocktake/current", headers=admin_h, timeout=20).json()
        assert cur and "lines" in cur and len(cur["lines"]) > 0
        assert "expected" in cur["lines"][0]

        # count 2 items with divergent values
        lime = _get_item(admin_h, "Lime Juice")
        fries = _get_item(admin_h, "Frozen Fries")
        lime_expected = lime["stock"]
        fries_expected = fries["stock"]

        lime_counted = lime_expected - 50    # 50ml short → negative variance
        fries_counted = fries_expected + 200 # +200g over → positive variance

        for iid, counted in [(lime["id"], lime_counted), (fries["id"], fries_counted)]:
            c = requests.post(
                f"{BASE}/api/inventory/stocktake/count",
                json={"item_id": iid, "counted": counted},
                headers=admin_h,
                timeout=20,
            )
            assert c.status_code == 200

        # close
        close = requests.post(f"{BASE}/api/inventory/stocktake/close", headers=admin_h, timeout=20)
        assert close.status_code == 200, close.text
        rpt = close.json()["report"]
        assert isinstance(rpt, list) and len(rpt) >= 2
        for row in rpt:
            assert set(("item_id", "name", "expected", "counted", "variance", "variance_value")) <= set(row.keys())

        # stock now reflects counted values
        lime_after = _get_item(admin_h, "Lime Juice")["stock"]
        fries_after = _get_item(admin_h, "Frozen Fries")["stock"]
        assert abs(lime_after - lime_counted) < 0.5
        assert abs(fries_after - fries_counted) < 0.5

        # movements: stocktake reason present
        m = requests.get(f"{BASE}/api/inventory/movements?limit=50", headers=admin_h, timeout=20).json()
        st_moves = [x for x in m if x["reason"] == "stocktake"]
        assert len(st_moves) >= 2


# =========================================================
# 4. ANALYTICS
# =========================================================
class TestAnalytics:
    def test_analytics_shape(self, admin_h):
        r = requests.get(f"{BASE}/api/inventory/analytics", headers=admin_h, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "rows" in data and "totals" in data and "days" in data
        assert isinstance(data["rows"], list) and len(data["rows"]) > 0
        row0 = data["rows"][0]
        for k in ("item_id", "name", "sold", "waste", "usage_value", "waste_value", "days_of_stock"):
            assert k in row0
        for k in ("usage_value", "waste_value", "restock_count"):
            assert k in data["totals"]


# =========================================================
# 5. KEG ↔ INVENTORY BRIDGE
# =========================================================
def _get_kegs(admin_h):
    return requests.get(f"{BASE}/api/kegs", headers=admin_h, timeout=20).json()


class TestKegInventoryBridge:
    def test_draught_items_seeded(self, admin_h):
        for name in ("Tsingtao Draught", "Asahi Draught", "Moonzen Draught"):
            it = _get_item(admin_h, name)
            assert it, f"Draught item {name} not seeded"
            assert it.get("category") == "Draught"
            assert it.get("purchase_unit_symbol") == "keg"

    def test_kegs_linked(self, admin_h):
        kegs = _get_kegs(admin_h)
        # find Tsingtao on-tap keg
        tsing = next((k for k in kegs if (k.get("product") or {}).get("name") == "Tsingtao" and k.get("status") == "on"), None)
        assert tsing, "No on-tap Tsingtao keg to test"
        assert tsing.get("inventory_item_id"), "Tsingtao keg missing inventory_item_id link"

    def test_pour_deducts_and_install_restocks(self, admin_h):
        # find Tsingtao product + on-tap keg
        prod = _get_product(admin_h, "Tsingtao")
        assert prod, "Tsingtao product missing"
        kegs = _get_kegs(admin_h)
        tsing_keg = next((k for k in kegs if k.get("product_id") == prod["id"] and k.get("status") == "on"), None)
        assert tsing_keg, "No on-tap Tsingtao keg"
        item = _get_item(admin_h, "Tsingtao Draught")
        assert item
        item_before = item["stock"]

        # order 1 x Tsingtao and pay
        line = {
            "product_id": prod["id"],
            "name": prod["name"],
            "price": prod["price"],
            "qty": 1,
            "course": "drink",
        }
        o = requests.post(
            f"{BASE}/api/orders",
            json={"order_type": "pick_up", "lines": [line], "service_charge_pct": 0},
            headers=admin_h,
            timeout=20,
        )
        assert o.status_code == 200, o.text
        oid = o.json()["id"]
        total = o.json()["total"]
        p = requests.post(
            f"{BASE}/api/orders/{oid}/pay",
            json={"method": "cash", "amount": total, "tip": 0, "splits": []},
            headers=admin_h,
            timeout=20,
        )
        assert p.status_code == 200
        time.sleep(0.4)

        item_after = _get_item(admin_h, "Tsingtao Draught")["stock"]
        delta = round(item_before - item_after, 3)
        assert abs(delta - 568.0) < 1.0, f"Tsingtao draught delta {delta}ml (expected 568)"

        # movement should have reason=sale, order_id
        m = requests.get(f"{BASE}/api/inventory/movements?limit=50", headers=admin_h, timeout=20).json()
        sale = next((x for x in m if x["item_name"] == "Tsingtao Draught" and x.get("order_id") == oid), None)
        assert sale, "no sale movement for draught pour"
        assert sale["reason"] == "sale"

        # install new keg → +30000ml, reason=restock, note contains 'installed'
        item_pre_install = _get_item(admin_h, "Tsingtao Draught")["stock"]
        inst = requests.post(f"{BASE}/api/kegs/{tsing_keg['id']}/new", headers=admin_h, timeout=20)
        assert inst.status_code == 200
        time.sleep(0.4)
        item_post_install = _get_item(admin_h, "Tsingtao Draught")["stock"]
        assert abs((item_post_install - item_pre_install) - 30000) < 1.0, (
            f"install delta {item_post_install - item_pre_install} (expected 30000)"
        )
        m2 = requests.get(f"{BASE}/api/inventory/movements?limit=50", headers=admin_h, timeout=20).json()
        inst_mv = next(
            (x for x in m2 if x["item_name"] == "Tsingtao Draught" and x["reason"] == "restock" and "install" in (x.get("note") or "").lower()),
            None,
        )
        assert inst_mv, "no restock movement for keg install"


# =========================================================
# 6. SIGN NORMALISATION regression on the adjust endpoint
# =========================================================
class TestSignNormalisation:
    def test_positive_waste_becomes_negative(self, admin_h):
        it = _get_item(admin_h, "Lime Juice")
        start = it["stock"]
        r = requests.post(
            f"{BASE}/api/inventory/items/{it['id']}/adjust",
            json={"qty": 20, "reason": "waste"},  # positive qty
            headers=admin_h,
            timeout=20,
        )
        assert r.status_code == 200
        assert r.json()["stock"] < start, "positive waste qty must subtract"
        assert r.json()["movement"]["delta_base"] < 0

    def test_negative_restock_becomes_positive(self, admin_h):
        it = _get_item(admin_h, "Lime Juice")
        start = it["stock"]
        r = requests.post(
            f"{BASE}/api/inventory/items/{it['id']}/adjust",
            json={"qty": -20, "reason": "restock"},  # negative qty
            headers=admin_h,
            timeout=20,
        )
        assert r.status_code == 200
        assert r.json()["stock"] > start, "negative restock qty must add"
        assert r.json()["movement"]["delta_base"] > 0
