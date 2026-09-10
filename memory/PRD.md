# HK Bar POS — Product Requirements

## Original Problem Statement
Advanced restaurant POS for a Hong Kong bar/restaurant running 11am–6am, 7 days a week. Dine-in / pick-up / delivery. Happy hours, cash & % discounts, automatic 10% service charge. Two areas (Backroom, Main+Terrace) with a full floorplan. Staff with different roles/permissions, member CRM, product categories, variants & modifiers, hold-and-fire courses. Must feel like Lightspeed Restaurant POS but better.

## Current Iteration Request (Sep 2026)
"i miss inventory tracking, input, edit · inventory parameters, elements to help tracking, measurement units database · full research, analysis first · full detailed code checker and fixing agent"
- Source: cloned https://github.com/bellybeeroperations-png/posrepotry into this environment
- User choices: product stock + ingredient recipes · predefined + custom units (ml, cl, l, g, kg, bottle, glass, unit, keg, pour, pint, half pint, piece, part, cup) · one-time audit + ongoing checker pipeline · auto-deduct on payment + manual adjustments with reasons · variant auto-scale (option a)

## Architecture
- Frontend: React 19 + TailwindCSS + shadcn/ui + Recharts + sonner
- Backend: FastAPI + Motor (MongoDB async), JWT (PyJWT) + bcrypt
- DB: MongoDB `test_database` (env DB_NAME) — collections incl. users, areas, tables, categories, products, orders, members, happy_hours, kegs, keg_pours, combos, vouchers, upsell_nudges, **units, inventory_items, inventory_movements, recipes**
- Theme: Hong Kong neon cyberpunk dark mode (`#0B0E14` bg, `#00F2FE` cyan, `#FFB800` amber)

## What's Implemented (v24 · Sep 2026 — P0/P1 backlog iteration)
- **Auto-86**: `_sync_86_flag()` in inventory router — a recipe-linked product is 86'd the moment any ingredient (or direct item) hits zero stock, and un-86'd on restock. Runs after every deduction, adjustment, PO receive and stocktake close. Adjust endpoint normalises qty sign by reason (waste/breakage always subtract).
- **Purchase orders / receiving**: `purchase_orders` collection + CRUD (`/api/inventory/purchase-orders`), receive flow restocks all lines (purchase→base unit conversion) with PO-referenced restock movements; double-receive blocked; manager-only writes.
- **Stocktake sessions**: `stocktakes` collection — start (snapshots expected stock), per-item counts (any staff), close applies corrections as stocktake movements + returns variance report with HKD values; cancel + history endpoints.
- **Inventory analytics** (`/api/inventory/analytics?days=30`): per-item sold/waste/restocked (usage units), usage + waste value in HKD, days-of-stock estimate; totals row.
- **Keg↔inventory bridge**: kegs get optional `inventory_item_id`; seeded "Tsingtao/Asahi/Moonzen Draught" items (purchase unit keg) mirror on-tap keg volume — pours deduct ml from the item, keg install restocks it. Kegs page shows ⇄ link badge and auto-links "<beer> Draught" on Add Keg.
- **Frontend**: Inventory page now 8 tabs (Stock, Items, Recipes, Units, Purchases, Stocktake, Analytics, Movements); PO modal, stocktake count grid + variance report, analytics table.
- **GitHub push**: BLOCKED — no credentials in pod (no gh CLI, no SSH key, no token). Repo remote added as `origin`; needs a GitHub PAT with repo write to push.

## What's Implemented (v23 · Sep 2026 — Inventory + Code-Checker iteration)
- **Environment restore**: cloned full repo into this pod; added missing JWT_SECRET + ADMIN_* env vars; login verified (polymuze111@gmail.com / admin123)
- **Code audit & fixes (one-time)**: autoflake (10 unused imports), isort+black (25 files), E741 `l`→`line` renames (server/kegs/orders), E701 one-liners split, mypy 58→0 errors (serialize Optional, dict annotations, stripe pm guard, loyalty week-parse cleanup)
- **Real bug found & fixed**: `PreauthModal.jsx` had a stale duplicated return block → whole frontend failed to compile ("return outside of function"). Truncated stray lines; app compiles again.
- **Real bug found & fixed**: stale test `test_iter25_loyalty.py::test_summary_structure` assumed empty voucher wallet, broken by iter27 signup voucher — assertion now checks all vouchers are `source=signup`.
- **Ongoing checker**: `scripts/code_check.sh` (flake8 + isort + black + mypy + pytest serial), `--fix` mode for auto-format. Config: `backend/setup.cfg` (flake8), `backend/mypy.ini`. pytest runs `-n 0` (serial) — suite assumes shared sequential state.
- **Measurement units DB** (`/api/inventory/units`): 15 seeded units across volume (ml base), mass (g base), count (unit base) with factor_to_base conversions; full CRUD, manager-only writes, duplicate-symbol guard, delete blocked when in use, custom units supported.
- **Inventory items & stock** (`/api/inventory/items`): name/SKU/category/supplier, purchase unit vs usage unit, cost per purchase unit, par + reorder levels, opening stock; computed stock in usage units, stock value, low/out-of-stock flags. 12 demo items seeded.
- **Manual adjustments with reasons** (`POST /items/{id}/adjust`): restock / waste / breakage / correction / stocktake (absolute count); every change logged to `inventory_movements` with before→after, user, note. Movements ledger endpoint with per-item filter.
- **Recipes + auto-deduction** (`/api/inventory/recipes`, upsert by product): ingredient lines (item + qty + any unit, auto-converted to base) OR direct-item sell-as-is mode; `variant_multipliers` auto-scale (Double ×2). Hooked into payment via `decrement_kegs_for_order` → `deduct_inventory_for_order` (best-effort, never blocks payment). 6 recipes seeded (4 cocktails with Double ×2, fries, wings).
- **Frontend `/inventory` page** (nav "Stock"): 5 tabs — Stock (KPI cards, per-item adjust/edit), Items (table CRUD), Recipes (per-product editor with lines + variant multipliers + direct mode), Units (CRUD + conversion display), Movements (audit ledger with reason badges).
- **Verified via curl E2E**: 2× Old Fashioned paid → Bourbon −100ml with sale movement; waste −200ml; stocktake to absolute 6800ml; custom unit "crate" (7920ml) created; server role gets 403 on item create. Backend suite 114/115 → 115/115 after stale-test fix.

## Test Credentials
See /app/memory/test_credentials.md — admin polymuze111@gmail.com / admin123 (PIN 9999); staff PINs 1111–4444.

## Prioritized Backlog
### P0 (next iteration)
- Push the fixed repo back to GitHub — BLOCKED on credentials (needs a PAT with repo write; remote `origin` already configured)
- In-app confirm modal to replace window.confirm in stocktake close (blocks some e2e drivers)
### P1
- Extend keg↔item links to Asahi/Moonzen taps when those kegs go on-tap (bridge ready, just needs linking)
- Purchase-order receive warning when a line item lacks a purchase unit (currently skipped silently)
- Inventory variance trends report (stocktake history comparison)
### P2
- Multi-venue stock transfer, barcode scanning, supplier price history
- Frontend lint pipeline (eslint) added to code_check.sh
- Batch _sync_86_flag if recipe catalog grows large

## Next Tasks
1. User provides GitHub PAT (or pushes manually) to sync fixed code to bellybeeroperations-png/posrepotry
2. User reviews Purchases/Stocktake/Analytics tabs UX
3. P0/P1 items on request
