import { useEffect, useState, useCallback } from "react";
import { api, fmtHKD } from "@/lib/api";
import { toast } from "sonner";
import {
  Package, Plus, AlertTriangle, Trash2, Pencil, Beaker, Ruler,
  ClipboardList, ArrowDownCircle, ArrowUpCircle, Search,
  Truck, ClipboardCheck, BarChart3,
} from "lucide-react";
import { Modal, Kpi, inputCls } from "@/components/inventory/common";
import { PurchaseOrdersTab, POModal } from "@/components/inventory/PurchaseOrders";
import { StocktakeTab } from "@/components/inventory/Stocktake";
import { AnalyticsTab } from "@/components/inventory/Analytics";

const REASONS = [
  { id: "restock", label: "Restock", sign: 1 },
  { id: "waste", label: "Waste", sign: -1 },
  { id: "breakage", label: "Breakage", sign: -1 },
  { id: "correction", label: "Correction", sign: 0 },
  { id: "stocktake", label: "Stocktake (count)", sign: 0 },
];

const TABS = [
  { id: "stock", label: "Stock", icon: Package },
  { id: "items", label: "Items", icon: ClipboardList },
  { id: "recipes", label: "Recipes", icon: Beaker },
  { id: "units", label: "Units", icon: Ruler },
  { id: "orders", label: "Purchases", icon: Truck },
  { id: "stocktake", label: "Stocktake", icon: ClipboardCheck },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "movements", label: "Movements", icon: ArrowDownCircle },
];

export default function Inventory() {
  const [tab, setTab] = useState("stock");
  const [items, setItems] = useState([]);
  const [units, setUnits] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [products, setProducts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [pos, setPos] = useState([]);
  const [stocktake, setStocktake] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [poForm, setPoForm] = useState(false);
  const [summary, setSummary] = useState(null);
  const [q, setQ] = useState("");
  const [adjustFor, setAdjustFor] = useState(null);
  const [itemForm, setItemForm] = useState(null);   // {} for new, item for edit
  const [unitForm, setUnitForm] = useState(null);
  const [recipeFor, setRecipeFor] = useState(null); // product

  const load = useCallback(async () => {
    const [i, u, r, p, m, s, po, st, an] = await Promise.all([
      api.get("/inventory/items", { params: q ? { q } : {} }),
      api.get("/inventory/units"),
      api.get("/inventory/recipes"),
      api.get("/products"),
      api.get("/inventory/movements", { params: { limit: 100 } }),
      api.get("/inventory/summary"),
      api.get("/inventory/purchase-orders"),
      api.get("/inventory/stocktake/current"),
      api.get("/inventory/analytics"),
    ]);
    setItems(i.data); setUnits(u.data); setRecipes(r.data);
    setProducts(p.data); setMovements(m.data); setSummary(s.data);
    setPos(po.data); setStocktake(st.data); setAnalytics(an.data);
  }, [q]);
  useEffect(() => { load(); }, [load]);

  const delItem = async (it) => {
    if (!confirm(`Delete ${it.name}? Its recipe lines are removed too.`)) return;
    await api.delete(`/inventory/items/${it.id}`);
    toast.success("Item deleted"); load();
  };
  const delUnit = async (u) => {
    if (!confirm(`Delete unit ${u.name}?`)) return;
    try { await api.delete(`/inventory/units/${u.id}`); toast.success("Unit deleted"); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Cannot delete"); }
  };
  const delRecipe = async (r) => {
    if (!confirm(`Delete recipe for ${r.product_name}?`)) return;
    await api.delete(`/inventory/recipes/${r.id}`);
    toast.success("Recipe deleted"); load();
  };

  const recipeByPid = Object.fromEntries(recipes.map((r) => [r.product_id, r]));

  return (
    <div data-testid="inventory-page">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="font-display text-2xl font-black">Inventory</h1>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-[var(--muted)]" />
            <input data-testid="inventory-search" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search items…"
              className="pl-8 pr-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-sm w-52 outline-none focus:border-[var(--cyan)]" />
          </div>
          <button data-testid="btn-add-item" onClick={() => setItemForm({})}
            className="btn-neon px-4 py-2 rounded-lg text-xs uppercase flex items-center gap-2">
            <Plus size={14} /> Add Item
          </button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <Kpi label="Items" value={summary.total_items} color="#00F2FE" testid="inv-total" />
          <Kpi label="Low Stock" value={summary.low_stock} color="#FFB800" testid="inv-low" />
          <Kpi label="Out of Stock" value={summary.out_of_stock} color="#F43F5E" testid="inv-out" />
          <Kpi label="Stock Value" value={fmtHKD(summary.stock_value)} color="#10B981" testid="inv-value" />
        </div>
      )}

      <div className="flex gap-1 mb-4 border-b border-[var(--border)]">
        {TABS.map((t) => (
          <button key={t.id} data-testid={`tab-${t.id}`} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-mono uppercase tracking-wider flex items-center gap-2 border-b-2 -mb-px transition-colors ${
              tab === t.id ? "border-[var(--cyan)] text-[var(--cyan)]" : "border-transparent text-[var(--muted)] hover:text-white"
            }`}>
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "stock" && (
        <div className="grid grid-cols-3 gap-3">
          {items.map((it) => (
            <div key={it.id} data-testid={`stock-card-${it.name}`}
              className={`p-4 rounded-xl border bg-[var(--surface)] ${
                it.out_of_stock ? "border-[var(--rose)] animate-pulse" : it.low_stock ? "border-[var(--amber)]" : "border-[var(--border)]"
              }`}>
              <div className="flex items-center gap-2">
                <Package size={15} className="text-[var(--cyan)]" />
                <div className="font-display font-bold text-white">{it.name}</div>
                {it.out_of_stock
                  ? <span className="ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--rose)] text-white font-black">OUT</span>
                  : it.low_stock
                    ? <AlertTriangle size={14} className="ml-auto text-[var(--amber)]" />
                    : null}
              </div>
              <div className="text-[10px] font-mono uppercase text-[var(--muted)] mt-0.5">
                {it.category}{it.supplier ? ` · ${it.supplier}` : ""}
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <span data-testid={`stock-qty-${it.name}`} className="font-display font-black text-3xl"
                    style={{ color: it.out_of_stock ? "#F43F5E" : it.low_stock ? "#FFB800" : "#10B981" }}>
                    {+it.stock.toFixed(2)}
                  </span>
                  <span className="text-xs font-mono text-[var(--muted)] ml-1">{it.usage_unit_symbol || "units"}</span>
                </div>
                <div className="text-right text-[10px] font-mono text-[var(--muted)]">
                  <div>par {it.par_level} · reorder {it.reorder_level}</div>
                  <div>{fmtHKD(it.stock_value)}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 mt-3">
                <button data-testid={`btn-adjust-${it.name}`} onClick={() => setAdjustFor(it)}
                  className="py-1.5 rounded bg-[var(--cyan)]/10 border border-[var(--cyan)]/40 text-[10px] font-mono uppercase text-[var(--cyan)]">
                  Adjust
                </button>
                <button data-testid={`btn-edit-item-${it.name}`} onClick={() => setItemForm(it)}
                  className="py-1.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[10px] font-mono uppercase text-[var(--muted)] flex items-center justify-center gap-1">
                  <Pencil size={10} /> Edit
                </button>
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <div className="col-span-3 p-10 rounded-xl border border-dashed border-[var(--border)] text-center text-[var(--muted)]">
              No inventory items yet — add your first one.
            </div>
          )}
        </div>
      )}

      {tab === "items" && (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm" data-testid="items-table">
            <thead className="bg-[var(--surface-2)] text-[10px] font-mono uppercase text-[var(--muted)]">
              <tr>
                <th className="text-left px-4 py-2">Item</th><th className="text-left px-4 py-2">Category</th>
                <th className="text-left px-4 py-2">Buy</th><th className="text-left px-4 py-2">Use</th>
                <th className="text-right px-4 py-2">Cost / buy unit</th><th className="text-right px-4 py-2">Stock</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} data-testid={`item-row-${it.name}`} className="border-t border-[var(--border)] hover:bg-[var(--surface)]">
                  <td className="px-4 py-2 font-semibold text-white">{it.name}</td>
                  <td className="px-4 py-2 text-[var(--muted)]">{it.category}</td>
                  <td className="px-4 py-2 font-mono text-xs">{it.purchase_unit_symbol || "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs">{it.usage_unit_symbol || "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{fmtHKD(it.cost_per_purchase_unit)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: it.out_of_stock ? "#F43F5E" : it.low_stock ? "#FFB800" : "#10B981" }}>
                    {+it.stock.toFixed(2)} {it.usage_unit_symbol}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button data-testid={`item-edit-${it.name}`} onClick={() => setItemForm(it)} className="p-1 text-[var(--muted)] hover:text-[var(--cyan)]"><Pencil size={13} /></button>
                    <button data-testid={`item-del-${it.name}`} onClick={() => delItem(it)} className="p-1 text-[var(--muted)] hover:text-[var(--rose)]"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "recipes" && (
        <div>
          <div className="text-xs font-mono uppercase text-[var(--muted)] mb-3">
            Link menu products to ingredient depletion. Variant multipliers auto-scale (e.g. Double ×2).
          </div>
          <div className="grid grid-cols-2 gap-3">
            {products.filter((p) => p.active !== false).map((p) => {
              const r = recipeByPid[p.id];
              return (
                <div key={p.id} data-testid={`recipe-card-${p.name}`}
                  className={`p-4 rounded-xl border bg-[var(--surface)] ${r ? "border-[var(--cyan)]/40" : "border-[var(--border)]"}`}>
                  <div className="flex items-center gap-2">
                    <Beaker size={14} className={r ? "text-[var(--cyan)]" : "text-[var(--muted)]"} />
                    <div className="font-display font-bold text-white">{p.name}</div>
                    {r && r.direct_item_name && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--amber)]/20 text-[var(--amber)] uppercase">direct · {r.direct_item_name}</span>}
                    <div className="ml-auto flex gap-1">
                      <button data-testid={`recipe-edit-${p.name}`} onClick={() => setRecipeFor(p)}
                        className="py-1 px-2 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[10px] font-mono uppercase text-[var(--cyan)]">
                        {r ? "Edit" : "+ Recipe"}
                      </button>
                      {r && (
                        <button data-testid={`recipe-del-${p.name}`} onClick={() => delRecipe(r)}
                          className="p-1 text-[var(--muted)] hover:text-[var(--rose)]"><Trash2 size={13} /></button>
                      )}
                    </div>
                  </div>
                  {r && r.lines?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {r.lines.map((l) => (
                        <span key={`${l.item_id}-${l.unit_id || "base"}`} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--muted)]">
                          {l.item_name} {l.qty}{l.unit_symbol || ""}
                        </span>
                      ))}
                      {Object.entries(r.variant_multipliers || {}).map(([v, m]) => (
                        <span key={v} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--purple)]/15 border border-[var(--purple)]/40 text-[var(--purple)]">
                          {v} ×{m}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "units" && (
        <div>
          <div className="flex justify-end mb-3">
            <button data-testid="btn-add-unit" onClick={() => setUnitForm({})}
              className="btn-neon px-4 py-2 rounded-lg text-xs uppercase flex items-center gap-2">
              <Plus size={14} /> Add Unit
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {units.map((u) => (
              <div key={u.id} data-testid={`unit-card-${u.symbol}`} className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <div className="flex items-center gap-2">
                  <Ruler size={13} className="text-[var(--amber)]" />
                  <span className="font-display font-bold text-white">{u.name}</span>
                  {u.custom && <span className="text-[9px] font-mono px-1 rounded bg-[var(--purple)]/20 text-[var(--purple)] uppercase">custom</span>}
                </div>
                <div className="text-[10px] font-mono text-[var(--muted)] mt-1">
                  <span className="text-[var(--cyan)]">{u.symbol}</span> · {u.kind} · 1 {u.symbol} = {u.factor_to_base} {u.kind === "volume" ? "ml" : u.kind === "mass" ? "g" : "unit"}
                </div>
                <div className="flex gap-1 mt-2">
                  <button data-testid={`unit-edit-${u.symbol}`} onClick={() => setUnitForm(u)}
                    className="flex-1 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[10px] font-mono uppercase text-[var(--muted)]">Edit</button>
                  <button data-testid={`unit-del-${u.symbol}`} onClick={() => delUnit(u)}
                    className="py-1 px-2 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[10px] font-mono uppercase text-[var(--muted)] hover:text-[var(--rose)]"><Trash2 size={11} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "orders" && (
        <PurchaseOrdersTab pos={pos} onChanged={load} onNew={() => setPoForm(true)} />
      )}

      {tab === "stocktake" && (
        <StocktakeTab stocktake={stocktake} onChanged={load} />
      )}

      {tab === "analytics" && (
        <AnalyticsTab analytics={analytics} />
      )}

      {tab === "movements" && (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm" data-testid="movements-table">
            <thead className="bg-[var(--surface-2)] text-[10px] font-mono uppercase text-[var(--muted)]">
              <tr>
                <th className="text-left px-4 py-2">When</th><th className="text-left px-4 py-2">Item</th>
                <th className="text-left px-4 py-2">Reason</th><th className="text-right px-4 py-2">Change</th>
                <th className="text-right px-4 py-2">After</th><th className="text-left px-4 py-2">By</th>
                <th className="text-left px-4 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} data-testid={`movement-row-${m.id}`} className="border-t border-[var(--border)] hover:bg-[var(--surface)]">
                  <td className="px-4 py-2 font-mono text-xs text-[var(--muted)]">{(m.at || "").slice(5, 16).replace("T", " ")}</td>
                  <td className="px-4 py-2 font-semibold text-white">{m.item_name}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${
                      m.reason === "sale" ? "bg-[var(--cyan)]/15 text-[var(--cyan)]"
                      : m.reason === "restock" ? "bg-[var(--emerald)]/15 text-[var(--emerald)]"
                      : "bg-[var(--rose)]/15 text-[var(--rose)]"}`}>{m.reason}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: m.delta >= 0 ? "#10B981" : "#F43F5E" }}>
                    {m.delta >= 0 ? <ArrowUpCircle size={11} className="inline mr-1" /> : <ArrowDownCircle size={11} className="inline mr-1" />}
                    {m.delta > 0 ? "+" : ""}{m.delta} {m.unit_symbol}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-[var(--muted)]">{m.after} {m.unit_symbol}</td>
                  <td className="px-4 py-2 text-xs text-[var(--muted)]">{m.user_name || "system"}</td>
                  <td className="px-4 py-2 text-xs text-[var(--muted)] max-w-[200px] truncate">{m.note}</td>
                </tr>
              ))}
              {movements.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-[var(--muted)]">No stock movements yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {poForm && <POModal items={items} onClose={() => setPoForm(false)} onDone={() => { setPoForm(false); load(); }} />}
      {adjustFor && <AdjustModal item={adjustFor} onClose={() => setAdjustFor(null)} onDone={() => { setAdjustFor(null); load(); }} />}
      {itemForm && <ItemModal item={itemForm.id ? itemForm : null} units={units} onClose={() => setItemForm(null)} onDone={() => { setItemForm(null); load(); }} />}
      {unitForm && <UnitModal unit={unitForm.id ? unitForm : null} onClose={() => setUnitForm(null)} onDone={() => { setUnitForm(null); load(); }} />}
      {recipeFor && <RecipeModal product={recipeFor} recipe={recipeByPid[recipeFor.id]} items={items} units={units} onClose={() => setRecipeFor(null)} onDone={() => { setRecipeFor(null); load(); }} />}
    </div>
  );
}

function AdjustModal({ item, onClose, onDone }) {
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

function ItemModal({ item, units, onClose, onDone }) {
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

function UnitSelect({ label, testid, units, value, onChange }) {
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

function UnitModal({ unit, onClose, onDone }) {
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
        1 {f.symbol || "unit"} = ? {f.kind === "volume" ? "ml" : f.kind === "mass" ? "g" : "units"}
      </label>
      <input data-testid="unit-factor" type="number" min="0" step="any" value={f.factor_to_base ?? 1} onChange={(e) => set("factor_to_base", e.target.value)} className={`${inputCls} mt-1 mb-4`} />
      <button data-testid="unit-submit" onClick={submit} className="btn-neon w-full py-2.5 rounded-lg text-xs uppercase">
        {unit ? "Save Changes" : "Create Unit"}
      </button>
    </Modal>
  );
}

function RecipeModal({ product, recipe, items, units, onClose, onDone }) {
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

