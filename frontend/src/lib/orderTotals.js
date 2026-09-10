/**
 * Pure order-totals engine — mirrors the backend compute_totals exclusivity
 * rule: happy-hour-locked lines are excluded from combos, combo-locked lines
 * are excluded from order-level discounts. Kept outside the component so it
 * stays referentially stable and unit-testable.
 */
export function computeOrderTotals(order, combos) {
  if (!order) return {
    subtotal: 0, discount: 0, service: 0, total: 0,
    combos_applied: [], hh_locked: new Set(), combo_locked: new Set(),
    combo_line_map: {},
  };
  const sub = order.lines.reduce((s, l) => s + l.price * l.qty, 0);

  // 1) HH lock — any line the register already priced at happy-hour value
  const hhLocked = new Set(
    order.lines.filter(l => (l.hh_pct || 0) > 0 && l.product_id).map(l => l.product_id)
  );

  // 2) Build combo-eligible qty map (skip HH-locked pids)
  const lineQtys = {};
  order.lines.forEach(l => {
    if (l.product_id && !hhLocked.has(l.product_id) && (l.qty || 0) > 0) {
      lineQtys[l.product_id] = (lineQtys[l.product_id] || 0) + l.qty;
    }
  });

  // 3) Greedy best-first combo application
  const applied = [];
  const comboLocked = new Set();
  const comboLineMap = {}; // pid -> combo name (for UI badge)
  const potential = (c) =>
    c.discount_type === "percent" ? sub * (c.discount_value / 100) : c.discount_value;
  const sortedCombos = [...combos]
    .filter(c => c.active !== false)
    .sort((a, b) => potential(b) - potential(a));

  let comboDisc = 0;
  for (const c of sortedCombos) {
    const involved = new Set();
    (c.slots || []).forEach(s => (s.product_ids || []).forEach(pid => involved.add(pid)));
    if (!c.slots || !c.slots.length) (c.product_ids || []).forEach(pid => involved.add(pid));

    // Skip if any product already locked by another combo
    let overlap = false;
    involved.forEach(pid => { if (comboLocked.has(pid)) overlap = true; });
    if (overlap) continue;

    // Match check (mirrors backend _combo_matches, on lineQtys map that excludes HH-locked)
    let matches;
    if (c.slots && c.slots.length) {
      matches = c.slots.every(s => {
        const pids = s.product_ids || [];
        if (!pids.length) return false;
        const counts = pids.map(pid => lineQtys[pid] || 0);
        const total = counts.reduce((a, b) => a + b, 0);
        const min = s.min_qty ?? 1, max = s.max_qty ?? 99;
        if (s.operator === "and") return counts.every(n => n >= 1) && counts.every(n => n <= max);
        return total >= min && total <= max;
      });
    } else {
      const req = [...involved];
      matches = req.length > 0 && req.every(pid => (lineQtys[pid] || 0) >= 1);
    }
    if (!matches) continue;

    const d = potential(c);
    comboDisc += d;
    applied.push({ name: c.name, discount: d, locked_product_ids: [...involved] });
    involved.forEach(pid => {
      comboLocked.add(pid);
      comboLineMap[pid] = c.name;
      delete lineQtys[pid];
    });
  }

  // 4) Order-level discount only against lines NOT locked by HH or a combo
  const promoLocked = new Set([...hhLocked, ...comboLocked]);
  const discBase = order.lines
    .filter(l => !promoLocked.has(l.product_id))
    .reduce((s, l) => s + l.price * l.qty, 0);
  let disc = 0;
  if (order.discount_type === "percent") disc = discBase * (order.discount_value / 100);
  else if (order.discount_type === "cash") disc = Math.min(order.discount_value, discBase);

  const net = Math.max(0, sub - disc - comboDisc);
  const svc = net * (order.service_charge_pct / 100);
  return {
    subtotal: sub, discount: disc, service: svc, total: net + svc,
    combos_applied: applied,
    hh_locked: hhLocked, combo_locked: comboLocked, combo_line_map: comboLineMap,
  };
}
