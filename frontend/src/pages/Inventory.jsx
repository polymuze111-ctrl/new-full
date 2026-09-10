import { useEffect, useState, useCallback, useMemo } from "react";
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
import { AdjustModal, ItemModal, UnitModal, RecipeModal } from "@/components/inventory/Modals";



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

function stockColor(it) {
  if (it.out_of_stock) return "#F43F5E";
  if (it.low_stock) return "#FFB800";
  return "#10B981";
}

function stockCardCls(it) {
  if (it.out_of_stock) return "border-[var(--rose)] animate-pulse";
  if (it.low_stock) return "border-[var(--amber)]";
  return "border-[var(--border)]";
}

function baseUnitLabel(kind, plural = false) {
  if (kind === "volume") return "ml";
  if (kind === "mass") return "g";
  return plural ? "units" : "unit";
}

const REASON_BADGE = {
  sale: "bg-[var(--cyan)]/15 text-[var(--cyan)]",
  restock: "bg-[var(--emerald)]/15 text-[var(--emerald)]",
};
const REASON_BADGE_DEFAULT = "bg-[var(--rose)]/15 text-[var(--rose)]";

const StockBadge = ({ it }) => {
  if (it.out_of_stock) return <span className="ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--rose)] text-white font-black">OUT</span>;
  if (it.low_stock) return <AlertTriangle size={14} className="ml-auto text-[var(--amber)]" />;
  return null;
};

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

  const recipeByPid = useMemo(() => Object.fromEntries(recipes.map((r) => [r.product_id, r])), [recipes]);
  const activeProducts = useMemo(() => products.filter((p) => p.active !== false), [products]);

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
              className={`p-4 rounded-xl border bg-[var(--surface)] ${stockCardCls(it)}`}>
              <div className="flex items-center gap-2">
                <Package size={15} className="text-[var(--cyan)]" />
                <div className="font-display font-bold text-white">{it.name}</div>
                <StockBadge it={it} />
              </div>
              <div className="text-[10px] font-mono uppercase text-[var(--muted)] mt-0.5">
                {it.category}{it.supplier ? ` · ${it.supplier}` : ""}
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <span data-testid={`stock-qty-${it.name}`} className="font-display font-black text-3xl"
                    style={{ color: stockColor(it) }}>
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
                  <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: stockColor(it) }}>
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
            {activeProducts.map((p) => {
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
                  <span className="text-[var(--cyan)]">{u.symbol}</span> · {u.kind} · 1 {u.symbol} = {u.factor_to_base} {baseUnitLabel(u.kind)}
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
                    <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${REASON_BADGE[m.reason] || REASON_BADGE_DEFAULT}`}>{m.reason}</span>
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
