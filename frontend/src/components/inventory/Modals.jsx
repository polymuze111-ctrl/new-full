import { useState } from "react";
import { api, fmtHKD } from "@/lib/api";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Modal, inputCls } from "./common";

export const REASONS = [
  { id: "restock", label: "Restock", sign: 1 },
  { id: "waste", label: "Waste", sign: -1 },
  { id: "breakage", label: "Breakage", sign: -1 },
  { id: "correction", label: "Correction", sign: 0 },
  { id: "stocktake", label: "Stocktake (count)", sign: 0 },
];

export function AdjustModal({ item, onClose, onDone }) {
  const [reason, setReason] = useState("restock");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const r = REASONS.find((x) => x.id === reason);

  const submit = async () => {
    const v = parseFloat(qty);
    if (isNaN(v) || v < 0) return toast.error("Enter a valid quantity");
    try {
      const body = reason === "stocktake"
        ? { reason, new_stock: v, note, qty: 0 }
        : { reason, qty: r.sign === 0 ? v : r.sign * v, note };
      const res = await api.post(`/inventory/items/${item.id}/adjust`, body);
      toast.success(`${item.name}: ${res.data.stock} ${res.data.usage_unit_symbol || ""}`);
      onDone();
    } catch (e) { toast.error(e.response?.data?.detail || "Adjust failed"); }
  };

  return (
    <Modal title={`Adjust · ${item.name}`} onClose={onClose} testid="adjust-modal">
      <div className="text-xs font-mono text-[var(--muted)] mb-3">
        Current: <span className="text-[var(--cyan)]">{+item.stock.toFixed(2)} {item.usage_unit_symbol}</span>
      </div>
      <div className="grid grid-cols-5 gap-1 mb-3">
        {REASONS.map((x) => (
          <button key={x.id} data-testid={`reason-${x.id}`} onClick={() => setReason(x.id)}
            className={`py-2 rounded-lg text-[10px] font-mono uppercase border ${reason === x.id ? "border-[var(--cyan)] text-[var(--cyan)] bg-[var(--cyan)]/10" : "border-[var(--border)] text-[var(--muted)]"}`}>
            {x.label.split(" ")[0]}
          </button>
        ))}
      </div>
      <label className="text-[10px] font-mono uppercase text-[var(--muted)]">
        {reason === "stocktake" ? `Counted stock (${item.usage_unit_symbol})` : `Quantity (${item.usage_unit_symbol})`}
      </label>
      <input data-testid="adjust-qty" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={`${inputCls} mt-1 mb-3`} />
      <label className="text-[10px] font-mono uppercase text-[var(--muted)]">Note</label>
      <input data-testid="adjust-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. supplier delivery, dropped bottle…" className={`${inputCls} mt-1 mb-4`} />
      <button data-testid="adjust-submit" onClick={submit} className="btn-neon w-full py-2.5 rounded-lg text-xs uppercase">Apply Adjustment</button>
    </Modal>
  );
}

export function ItemModal({ item, units, onClose, onDone }) {
  const [f, setF] = useState(item || { name: "", category: "General", cost_per_purchase_unit: 0, opening_stock: 0, par_level: 0, reorder_level: 0, supplier: "", sku: "" });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!f.name?.trim()) return toast.error("Name required");
    const body = {
      name: f.name, sku: f.sku || "", category: f.category || "General",
      purchase_unit_id: f.purchase_unit_id || null, usage_unit_id: f.usage_unit_id || null,
      cost_per_purchase_unit: parseFloat(f.cost_per_purchase_unit) || 0,
      opening_stock: parseFloat(f.opening_stock) || 0,
      par_level: parseFloat(f.par_level) || 0, reorder_level: parseFloat(f.reorder_level) || 0,
      supplier: f.supplier || "", notes: f.notes || "",
    };
    try {
      if (item) await api.patch(`/inventory/items/${item.id}`, body);
      else await api.post("/inventory/items", body);
      toast.success(item ? "Item updated" : "Item created"); onDone();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };

  return (
    <Modal title={item ? `Edit · ${item.name}` : "New Inventory Item"} onClose={onClose} testid="item-modal">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-[10px] font-mono uppercase text-[var(--muted)]">Name</label>
          <input data-testid="item-name" value={f.name || ""} onChange={(e) => set("name", e.target.value)} className={`${inputCls} mt-1`} />
        </div>
        <div>
          <label className="text-[10px] font-mono uppercase text-[var(--muted)]">Category</label>
          <input data-testid="item-category" value={f.category || ""} onChange={(e) => set("category", e.target.value)} className={`${inputCls} mt-1`} />
        </div>
        <div>
          <label className="text-[10px] font-mono uppercase text-[var(--muted)]">Supplier</label>
          <input data-testid="item-supplier" value={f.supplier || ""} onChange={(e) => set("supplier", e.target.value)} className={`${inputCls} mt-1`} />
        </div>
        <UnitSelect label="Purchase unit (how you buy)" testid="item-purchase-unit" units={units} value={f.purchase_unit_id} onChange={(v) => set("purchase_unit_id", v)} />
        <UnitSelect label="Usage unit (how you track)" testid="item-usage-unit" units={units} value={f.usage_unit_id} onChange={(v) => set("usage_unit_id", v)} />
        <div>
          <label className="text-[10px] font-mono uppercase text-[var(--muted)]">Cost per purchase unit (HKD)</label>
          <input data-testid="item-cost" type="number" min="0" step="any" value={f.cost_per_purchase_unit ?? 0} onChange={(e) => set("cost_per_purchase_unit", e.target.value)} className={`${inputCls} mt-1`} />
        </div>
        {!item && (
          <div>
            <label className="text-[10px] font-mono uppercase text-[var(--muted)]">Opening stock (usage units)</label>
            <input data-testid="item-opening-stock" type="number" min="0" step="any" value={f.opening_stock ?? 0} onChange={(e) => set("opening_stock", e.target.value)} className={`${inputCls} mt-1`} />
          </div>
        )}
        <div>
          <label className="text-[10px] font-mono uppercase text-[var(--muted)]">Par level</label>
          <input data-testid="item-par" type="number" min="0" step="any" value={f.par_level ?? 0} onChange={(e) => set("par_level", e.target.value)} className={`${inputCls} mt-1`} />
        </div>
        <div>
          <label className="text-[10px] font-mono uppercase text-[var(--muted)]">Reorder alert at</label>
          <input data-testid="item-reorder" type="number" min="0" step="any" value={f.reorder_level ?? 0} onChange={(e) => set("reorder_level", e.target.value)} className={`${inputCls} mt-1`} />
        </div>
      </div>
      <button data-testid="item-submit" onClick={submit} className="btn-neon w-full py-2.5 rounded-lg text-xs uppercase mt-4">
        {item ? "Save Changes" : "Create Item"}
      </button>
    </Modal>
  );
}

export function UnitSelect({ label, testid, units, value, onChange }) {
  return (
    <div>
      <label className="text-[10px] font-mono uppercase text-[var(--muted)]">{label}</label>
      <select data-testid={testid} value={value || ""} onChange={(e) => onChange(e.target.value || null)} className={`${inputCls} mt-1`}>
        <option value="">—</option>
        {units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.symbol})</option>)}
      </select>
    </div>
  );
}

export function UnitModal({ unit, onClose, onDone }) {
  const [f, setF] = useState(unit || { name: "", symbol: "", kind: "volume", factor_to_base: 1 });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!f.name?.trim() || !f.symbol?.trim()) return toast.error("Name + symbol required");
    const body = { name: f.name, symbol: f.symbol, kind: f.kind, factor_to_base: parseFloat(f.factor_to_base) || 1, active: true };
    try {
      if (unit) await api.patch(`/inventory/units/${unit.id}`, body);
      else await api.post("/inventory/units", body);
      toast.success(unit ? "Unit updated" : "Unit created"); onDone();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };

  return (
    <Modal title={unit ? `Edit · ${unit.name}` : "New Measurement Unit"} onClose={onClose} testid="unit-modal">
      <label className="text-[10px] font-mono uppercase text-[var(--muted)]">Name</label>
      <input data-testid="unit-name" value={f.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Crate (24 bottles)" className={`${inputCls} mt-1 mb-3`} />
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[10px] font-mono uppercase text-[var(--muted)]">Symbol</label>
          <input data-testid="unit-symbol" value={f.symbol || ""} onChange={(e) => set("symbol", e.target.value)} placeholder="crate" className={`${inputCls} mt-1`} />
        </div>
        <div>
          <label className="text-[10px] font-mono uppercase text-[var(--muted)]">Kind</label>
          <select data-testid="unit-kind" value={f.kind} onChange={(e) => set("kind", e.target.value)} className={`${inputCls} mt-1`}>
            <option value="volume">volume (base ml)</option>
            <option value="mass">mass (base g)</option>
            <option value="count">count (base unit)</option>
          </select>
        </div>
      </div>
      <label className="text-[10px] font-mono uppercase text-[var(--muted)]">
        1 {f.symbol || "unit"} = ? {baseUnitLabel(f.kind, true)}
      </label>
      <input data-testid="unit-factor" type="number" min="0" step="any" value={f.factor_to_base ?? 1} onChange={(e) => set("factor_to_base", e.target.value)} className={`${inputCls} mt-1 mb-4`} />
      <button data-testid="unit-submit" onClick={submit} className="btn-neon w-full py-2.5 rounded-lg text-xs uppercase">
        {unit ? "Save Changes" : "Create Unit"}
      </button>
    </Modal>
  );
}

function baseUnitLabel(kind, plural = false) {
  if (kind === "volume") return "ml";
  if (kind === "mass") return "g";
  return plural ? "units" : "unit";
}

export function RecipeModal({ product, recipe, items, units, onClose, onDone }) {
  const [mode, setMode] = useState(recipe?.direct_item_id ? "direct" : "lines");
  const [directItemId, setDirectItemId] = useState(recipe?.direct_item_id || "");
  const [lines, setLines] = useState(recipe?.lines?.map((l) => ({ item_id: l.item_id, qty: l.qty, unit_id: l.unit_id || "", uid: crypto.randomUUID() })) || []);
  const [mults, setMults] = useState(recipe?.variant_multipliers || {});
  const variants = (product.variants || []).map((v) => v.name);

  const setLine = (uid, k, v) => setLines((p) => p.map((l) => (l.uid === uid ? { ...l, [k]: v } : l)));

  const submit = async () => {
    const body = {
      product_id: product.id,
      lines: mode === "lines" ? lines.filter((l) => l.item_id && parseFloat(l.qty) > 0).map((l) => ({ item_id: l.item_id, qty: parseFloat(l.qty), unit_id: l.unit_id || null })) : [],
      direct_item_id: mode === "direct" ? directItemId || null : null,
      variant_multipliers: Object.fromEntries(Object.entries(mults).filter(([, m]) => parseFloat(m) > 0).map(([k, m]) => [k, parseFloat(m)])),
      active: true,
    };
    if (mode === "direct" && !body.direct_item_id) return toast.error("Pick the stock item sold as-is");
    if (mode === "lines" && body.lines.length === 0) return toast.error("Add at least one ingredient line");
    try {
      await api.post("/inventory/recipes", body);
      toast.success(`Recipe saved for ${product.name}`); onDone();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };

  return (
    <Modal title={`Recipe · ${product.name}`} onClose={onClose} testid="recipe-modal">
      <div className="grid grid-cols-2 gap-1 mb-4">
        {[["lines", "Ingredient list"], ["direct", "Sell item as-is"]].map(([m, lbl]) => (
          <button key={m} data-testid={`recipe-mode-${m}`} onClick={() => setMode(m)}
            className={`py-2 rounded-lg text-[10px] font-mono uppercase border ${mode === m ? "border-[var(--cyan)] text-[var(--cyan)] bg-[var(--cyan)]/10" : "border-[var(--border)] text-[var(--muted)]"}`}>
            {lbl}
          </button>
        ))}
      </div>

      {mode === "direct" ? (
        <>
          <label className="text-[10px] font-mono uppercase text-[var(--muted)]">Stock item deducted (1 usage unit per sale)</label>
          <select data-testid="recipe-direct-item" value={directItemId} onChange={(e) => setDirectItemId(e.target.value)} className={`${inputCls} mt-1 mb-3`}>
            <option value="">— pick item —</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </>
      ) : (
        <>
          {lines.map((l, i) => (
            <div key={l.uid} className="grid grid-cols-[1fr_90px_110px_32px] gap-2 mb-2" data-testid={`recipe-line-${i}`}>
              <select data-testid={`recipe-item-${i}`} value={l.item_id} onChange={(e) => setLine(l.uid, "item_id", e.target.value)} className={inputCls}>
                <option value="">— item —</option>
                {items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <input data-testid={`recipe-qty-${i}`} type="number" min="0" step="any" value={l.qty} onChange={(e) => setLine(l.uid, "qty", e.target.value)} placeholder="qty" className={inputCls} />
              <select data-testid={`recipe-unit-${i}`} value={l.unit_id} onChange={(e) => setLine(l.uid, "unit_id", e.target.value)} className={inputCls}>
                <option value="">item unit</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.symbol}</option>)}
              </select>
              <button data-testid={`recipe-line-del-${i}`} onClick={() => setLines((p) => p.filter((x) => x.uid !== l.uid))} className="text-[var(--muted)] hover:text-[var(--rose)]"><Trash2 size={14} /></button>
            </div>
          ))}
          <button data-testid="recipe-add-line" onClick={() => setLines((p) => [...p, { item_id: "", qty: "", unit_id: "", uid: crypto.randomUUID() }])}
            className="w-full py-2 rounded-lg border border-dashed border-[var(--border)] text-[10px] font-mono uppercase text-[var(--muted)] hover:text-[var(--cyan)] hover:border-[var(--cyan)] mb-3">
            + Add ingredient
          </button>
        </>
      )}

      {variants.length > 0 && (
        <div className="mb-3">
          <label className="text-[10px] font-mono uppercase text-[var(--muted)]">Variant auto-scale multipliers</label>
          <div className="grid grid-cols-3 gap-2 mt-1">
            {variants.map((v) => (
              <div key={v} className="flex items-center gap-1">
                <span className="text-[10px] font-mono text-[var(--muted)] flex-1 truncate">{v}</span>
                <input data-testid={`recipe-mult-${v}`} type="number" min="0" step="any" value={mults[v] ?? ""} placeholder="1"
                  onChange={(e) => setMults((p) => ({ ...p, [v]: e.target.value }))} className={`${inputCls} w-16`} />
              </div>
            ))}
          </div>
        </div>
      )}

      <button data-testid="recipe-submit" onClick={submit} className="btn-neon w-full py-2.5 rounded-lg text-xs uppercase">Save Recipe</button>
    </Modal>
  );
}
