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
- Auto-86 product when a recipe ingredient hits zero stock
- Purchase orders / supplier receiving flow (restock currently manual)
- Push the fixed repo back to GitHub (user action or via git push)
### P1
- Keg↔inventory bridge: keg volume as an inventory item so draught appears in stock value
- Stocktake sessions (full-count mode with variance report)
- Inventory reports tab (usage velocity, waste cost, COGS vs revenue)
### P2
- Multi-venue stock transfer, barcode scanning, supplier price history
- Frontend lint pipeline (eslint) added to code_check.sh

## Next Tasks
1. Run testing agent for full E2E validation of inventory flows
2. User reviews /inventory page UX
3. P0 backlog items on request
