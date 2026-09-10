# HK Bar POS — Product Requirements

## Original Problem Statement
Advanced restaurant POS for a Hong Kong bar/restaurant running 11am–6am, 7 days a week. Dine-in / pick-up / delivery. Happy hours, cash & % discounts, automatic 10% service charge. Two areas (Backroom, Main+Terrace) with a full floorplan. Staff with different roles/permissions, member CRM, product categories, variants & modifiers, hold-and-fire courses. Must feel like Lightspeed Restaurant POS but better.

## Architecture
- Frontend: React 19 + TailwindCSS + shadcn/ui + Recharts + sonner
- Backend: FastAPI + Motor (MongoDB async), JWT (PyJWT) + bcrypt — **auth via httpOnly cookie only** (no JS-readable tokens)
- DB: MongoDB `test_database` (env DB_NAME)
- Theme: Hong Kong neon cyberpunk dark mode (`#0B0E14` bg, `#00F2FE` cyan, `#FFB800` amber)
- Code checker: `bash /app/scripts/code_check.sh` — flake8 + isort + black + mypy + pytest (serial, fresh DB reseed). `--fix` for auto-format.

## What's Implemented (v26 · Sep 2026 — Code-quality report #2 fixes)
- **Backend complexity refactors** (behavior-preserving, suite-verified): orders.py `_combo_matches`→+`_slot_matches`, `_compute_totals`→+`_hh_locked_pids`/`_combo_qty_map`/`_combo_potential`/`_apply_combos`/`_order_level_discount`, `combo_hints`→+`_table_combo_hints`, `pay_order`→+`_build_payment`/`_apply_member_loyalty`; inventory.py `list_recipes`→+`_enrich_recipe`/`_recipe_line_view`, `stocktake_close`→+`_apply_stocktake_count`; kegs.py `_aggregate_prep`→+`_prep_entry`; loyalty.py `_hh_points_boost`→+`_any_hh_window_active`, `_visit_streak_bonus`→+`_is_consecutive_week`, `send_weekly_digest`→+`_weekly_digest_body`.
- **Real bug fixed**: ComboEditor slot handlers used stale `slots` closures → converted to functional setState in new `useComboSlots` hook (toggling products no longer risks clobbering other slots).
- **Verified false positives in report**: hook-dependency flags targeted module-level `api` import and callback params; referenced non-existent files (LoyaltyTiers.jsx, GuestSummary.jsx, InventoryCounts.jsx); zero real `is`-vs-`==` bugs (analyzer matched the docstring "86'd").
- **Component splits**: Receipt.jsx → `src/lib/receiptHtml.js` (lineRows/splitRows/paymentSection helpers); Reservations.jsx TableActionModal → +MergePicker/TableActions; Stocktake.jsx → +StocktakeReport/varianceColor.
- **Nested ternaries eliminated**: Inventory.jsx ×7 (stockColor/stockCardCls/baseUnitLabel/StockBadge/REASON_BADGE), ComboEditor initialSlotsFor, PreauthModal holdLabel, Stocktake varianceColor.
- **Perf**: PaymentModal PAYABLE_METHODS module const; Inventory recipeByPid useMemo; Shift visibleHistory useMemo.
- **Production cleanup**: all 6 frontend console.* statements removed (PreauthModal, RegisterUpsellStrip ×3, AuthContext, printable.js).
- Verified: ALL CHECKS PASSED (flake8/isort/black/mypy/pytest 143/143), UI screenshots clean.

## What's Implemented (v25 · Sep 2026 — Code-quality report fixes)
- **Security (critical)**: auth token removed from localStorage entirely — httpOnly `access_token` cookie only; api.js interceptor deleted; AuthContext rehydrates via `/auth/me` with `withCredentials`. Backend already set/cleared the cookie on login/pin-login/logout.
- **Hook stale-closure fixes**: Loyalty `load` wrapped in useCallback with correct deps; Register + QuickBar happy-hour logic deduped into `src/hooks/useHappyHour.js`; Register's 85-line totals memo extracted to pure `src/lib/orderTotals.js::computeOrderTotals` (unit-testable, referentially stable).
- **Complex backend functions refactored** (behavior-preserving): `on_payment_earn` (complexity 41 → orchestrator + 8 helpers: tier points, stamps, promo, scratch, birthday, HH boost, streak, referral); `push_send` (→ `_twilio_client`, `_compose_push_message`, `_deliver_push`); `deduct_inventory_for_order` (→ `_compute_order_deltas` + `_apply_inventory_deltas`); `inventory_analytics` (→ `_aggregate_movement_totals` + `_analytics_row`); `prep_view` (→ `_aggregate_prep`).
- **Component splits**: Floorplan 488→336 lines (sections → `components/pos/floorplan/FloorplanSections.jsx`); Inventory ~950→596 lines (tabs/modals → `components/inventory/{common,PurchaseOrders,Stocktake,Analytics}.jsx`); Register 375→268 lines.
- **Stable list keys**: recipe chips keyed by item_id; recipe/PO editor rows use `crypto.randomUUID()` uids (deleting a middle row no longer scrambles inputs).
- **Inline chart objects → module constants**: Reports (TOOLTIP_STYLE, BAR_RADIUS_TOP/RIGHT), Kegs (TOOLTIP_STYLE, DOT_STYLE), PreauthModal (CARD_ELEMENT_OPTIONS, useMemo elementsOptions).
- **Test hygiene**: 26× `is True/is False` → `==` across backend tests.
- Verified: ALL CHECKS PASSED (flake8/isort/black/mypy clean, 143/143 pytest), UI screenshots confirm cookie login persists across reload, all split pages render.

## What's Implemented (v24 · Sep 2026 — P0/P1 backlog iteration)
- **Auto-86**: `_sync_86_flag()` — recipe-linked products 86'd at zero stock, un-86'd on restock; runs after every deduction/adjustment/PO receive/stocktake close. Adjust endpoint normalises qty sign by reason.
- **Purchase orders / receiving**: `purchase_orders` collection + Purchases tab; receive restocks all lines with PO-referenced movements; double-receive blocked.
- **Stocktake sessions**: start → count → close with HKD variance report; cancel + history.
- **Inventory analytics**: per-item sold/waste/restocked, usage+waste value, days-of-stock (30d window).
- **Keg↔inventory bridge**: kegs link to draught items (Tsingtao/Asahi/Moonzen Draught); pours deduct, installs restock; ⇄ badge on Kegs page.

## What's Implemented (v23 · Sep 2026 — Inventory + Code-Checker iteration)
- Environment restore from GitHub clone; missing JWT_SECRET/ADMIN_* env vars added
- One-time audit: ~100 lint/format/type issues fixed (mypy 58→0); real bugs fixed: PreauthModal.jsx broken build, stale loyalty test
- `scripts/code_check.sh` pipeline + setup.cfg + mypy.ini
- Measurement units DB (15 seeded units, ml/g/unit bases, custom units + conversions)
- Inventory items CRUD, manual adjustments with reasons + movement ledger
- Recipes with variant multipliers + pay-time auto-deduction; `/inventory` page (8 tabs)

## Test Credentials
See /app/memory/test_credentials.md — admin polymuze111@gmail.com / admin123 (PIN 9999); staff PINs 1111–4444.

## Prioritized Backlog
### P0
- Push fixed repo to GitHub — BLOCKED on credentials (needs PAT with repo write; remote `origin` configured)
### P1
- In-app confirm modal replacing window.confirm (stocktake close, PO receive)
- PO receive warning when a line item lacks a purchase unit
- Link Asahi/Moonzen kegs when those taps go live
- Stocktake variance trend report
### P2
- Multi-venue transfers, barcode scanning, supplier price history
- eslint react-hooks pipeline for frontend in code_check.sh
- Batch _sync_86_flag if catalog grows

## Next Tasks
1. User provides GitHub PAT (or pushes manually) to sync code
2. P0/P1 items on request
