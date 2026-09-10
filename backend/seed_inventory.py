"""Idempotent inventory seed: measurement units, demo stock items, recipes."""

from datetime import datetime, timezone

# name, symbol, kind, factor_to_base  (base: ml / g / unit)
UNITS = [
    ("Millilitre", "ml", "volume", 1),
    ("Centilitre", "cl", "volume", 10),
    ("Litre", "l", "volume", 1000),
    ("US Cup", "cup", "volume", 240),
    ("Half Pint", "half_pint", "volume", 284),
    ("Pint", "pint", "volume", 568),
    ("Pour / Shot", "pour", "volume", 30),
    ("Part", "part", "volume", 30),
    ("Glass (150ml)", "glass", "volume", 150),
    ("Bottle (700ml)", "bottle", "volume", 700),
    ("Keg (30L)", "keg", "volume", 30000),
    ("Gram", "g", "mass", 1),
    ("Kilogram", "kg", "mass", 1000),
    ("Unit", "unit", "count", 1),
    ("Piece", "piece", "count", 1),
]

# name, category, purchase_sym, usage_sym, cost(HKD), opening, par, reorder, supplier
ITEMS = [
    (
        "Bourbon Whiskey",
        "Spirits",
        "bottle",
        "ml",
        320,
        7000,
        2100,
        1400,
        "Moiré Spirits Co.",
    ),
    (
        "London Dry Gin",
        "Spirits",
        "bottle",
        "ml",
        300,
        7000,
        2100,
        1400,
        "Moiré Spirits Co.",
    ),
    ("Vodka", "Spirits", "bottle", "ml", 260, 7000, 2100, 1400, "Moiré Spirits Co."),
    ("Campari", "Spirits", "bottle", "ml", 280, 3500, 1400, 700, "EuroBev HK"),
    ("Sweet Vermouth", "Spirits", "bottle", "ml", 180, 3500, 1400, 700, "EuroBev HK"),
    (
        "Lychee Liqueur",
        "Spirits",
        "bottle",
        "ml",
        240,
        2100,
        1400,
        700,
        "Asia Craft Spirits",
    ),
    ("Angostura Bitters", "Spirits", "bottle", "ml", 150, 700, 200, 100, "EuroBev HK"),
    ("Lime Juice", "Grocery", "l", "ml", 45, 5000, 2000, 1000, "FreshMart"),
    ("Sugar Syrup", "Grocery", "l", "ml", 30, 4000, 2000, 800, "FreshMart"),
    ("Mint Leaves", "Grocery", "kg", "g", 400, 500, 200, 100, "FreshMart"),
    ("Frozen Fries", "Kitchen", "kg", "g", 40, 20000, 10000, 5000, "Sysco HK"),
    ("Chicken Wings (raw)", "Kitchen", "kg", "g", 90, 15000, 8000, 4000, "Sysco HK"),
]

# product name -> (lines [(item, qty, unit_sym)], multipliers)
RECIPES = [
    (
        "Hong Kong Sour",
        [
            ("Bourbon Whiskey", 50, "ml"),
            ("Lime Juice", 25, "ml"),
            ("Sugar Syrup", 15, "ml"),
        ],
        {"Double": 2.0},
    ),
    (
        "Neon Negroni",
        [
            ("London Dry Gin", 30, "ml"),
            ("Campari", 30, "ml"),
            ("Sweet Vermouth", 30, "ml"),
        ],
        {"Double": 2.0},
    ),
    (
        "Lychee Martini",
        [("Vodka", 40, "ml"), ("Lychee Liqueur", 30, "ml"), ("Lime Juice", 10, "ml")],
        {},
    ),
    (
        "Old Fashioned",
        [
            ("Bourbon Whiskey", 50, "ml"),
            ("Sugar Syrup", 10, "ml"),
            ("Angostura Bitters", 2, "ml"),
        ],
        {},
    ),
    ("Truffle Fries", [("Frozen Fries", 180, "g")], {}),
    ("Chicken Wings", [("Chicken Wings (raw)", 250, "g")], {}),
]


async def seed_inventory(db):
    await _seed_units(db)
    await _seed_items_and_recipes(db)


async def _seed_units(db):
    if await db.units.count_documents({}) > 0:
        return
    now = datetime.now(timezone.utc).isoformat()
    await db.units.insert_many(
        [
            {
                "name": n,
                "symbol": s,
                "kind": k,
                "factor_to_base": f,
                "active": True,
                "custom": False,
                "created_at": now,
            }
            for n, s, k, f in UNITS
        ]
    )


async def _seed_items_and_recipes(db):
    if await db.inventory_items.count_documents({}) > 0:
        return
    units = {u["symbol"]: u for u in await db.units.find().to_list(200)}
    now = datetime.now(timezone.utc).isoformat()

    def base(qty, sym):
        return round(qty * units[sym]["factor_to_base"], 3)

    item_ids = {}
    docs = []
    for name, cat, pu, uu, cost, opening, par, reorder, supplier in ITEMS:
        doc = {
            "name": name,
            "sku": "",
            "category": cat,
            "purchase_unit_id": str(units[pu]["_id"]),
            "usage_unit_id": str(units[uu]["_id"]),
            "cost_per_purchase_unit": cost,
            "base_kind": units[uu]["kind"],
            "stock_base": base(opening, uu),
            "par_level": par,
            "reorder_level": reorder,
            "supplier": supplier,
            "notes": "",
            "active": True,
            "created_at": now,
        }
        docs.append(doc)
    if not docs:
        return
    res = await db.inventory_items.insert_many(docs)
    for doc, iid in zip(docs, res.inserted_ids):
        item_ids[doc["name"]] = str(iid)

    prods = {
        p["name"]: p
        async for p in db.products.find({"name": {"$in": [r[0] for r in RECIPES]}})
    }
    rdocs = []
    for pname, lines, mults in RECIPES:
        p = prods.get(pname)
        if not p:
            continue
        rdocs.append(
            {
                "product_id": str(p["_id"]),
                "lines": [
                    {
                        "item_id": item_ids[iname],
                        "qty": qty,
                        "unit_id": str(units[sym]["_id"]),
                    }
                    for iname, qty, sym in lines
                    if iname in item_ids
                ],
                "direct_item_id": None,
                "variant_multipliers": mults,
                "active": True,
                "created_at": now,
                "updated_at": now,
            }
        )
    if rdocs:
        await db.recipes.insert_many(rdocs)
