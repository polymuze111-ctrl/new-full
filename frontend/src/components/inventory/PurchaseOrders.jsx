import { useState } from "react";
import { api, fmtHKD } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Modal, inputCls } from "./common";

const PO_STATUS = { open: "#FFB800", received: "#10B981", cancelled: "#94A3B8" };

export function PurchaseOrdersTab({ pos, onChanged, onNew }) {
  const receive = async (po) => {
    if (!confirm(`Receive PO #${po.id.slice(-6)}? Every line is restocked.`)) return;
    try {
      await api.post(`/inventory/purchase-orders/${po.id}/receive`);
      toast.success("PO received — stock updated"); onChanged();
    } catch (e) { toast.error(e.response?.data?.detail || "Receive failed"); }
  };
  const cancel = async (po) => {
    if (!confirm(`Cancel PO #${po.id.slice(-6)}?`)) return;
    try {
      await api.post(`/inventory/purchase-orders/${po.id}/cancel`);
      toast.success("PO cancelled"); onChanged();
    } catch (e) { toast.error(e.response?.data?.detail || "Cancel failed"); }
  };

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button data-testid="btn-new-po" onClick={onNew}
          className="btn-neon px-4 py-2 rounded-lg text-xs uppercase flex items-center gap-2">
          <Plus size={14} /> New Purchase Order
        </button>
      </div>
      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <table className="w-full text-sm" data-testid="po-table">
          <thead className="bg-[var(--surface-2)] text-[10px] font-mono uppercase text-[var(--muted)]">
            <tr>
              <th className="text-left px-4 py-2">PO</th><th className="text-left px-4 py-2">Supplier</th>
              <th className="text-left px-4 py-2">Lines</th><th className="text-right px-4 py-2">Total</th>
              <th className="text-left px-4 py-2">Status</th><th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {pos.map((po) => (
              <tr key={po.id} data-testid={`po-row-${po.id.slice(-6)}`} className="border-t border-[var(--border)] hover:bg-[var(--surface)]">
                <td className="px-4 py-2 font-mono text-xs text-[var(--muted)]">#{po.id.slice(-6)}<br />{(po.created_at || "").slice(0, 10)}</td>
                <td className="px-4 py-2 font-semibold text-white">{po.supplier || "—"}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {(po.lines || []).map((l) => (
                      <span key={l.item_id} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[var(--muted)]">
                        {l.item_name} {l.qty}{l.unit_symbol || ""}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">{fmtHKD(po.total_cost)}</td>
                <td className="px-4 py-2">
                  <span data-testid={`po-status-${po.id.slice(-6)}`} className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded font-black"
                    style={{ color: PO_STATUS[po.status], background: `${PO_STATUS[po.status]}22` }}>
                    {po.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {po.status === "open" && (
                    <>
                      <button data-testid={`po-receive-${po.id.slice(-6)}`} onClick={() => receive(po)}
                        className="py-1 px-2 rounded bg-[var(--emerald)]/15 border border-[var(--emerald)]/40 text-[10px] font-mono uppercase text-[var(--emerald)] mr-1">Receive</button>
                      <button data-testid={`po-cancel-${po.id.slice(-6)}`} onClick={() => cancel(po)}
                        className="py-1 px-2 rounded bg-[var(--surface-2)] border border-[var(--border)] text-[10px] font-mono uppercase text-[var(--muted)]">Cancel</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {pos.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-[var(--muted)]">No purchase orders yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function POModal({ items, onClose, onDone }) {
  const [supplier, setSupplier] = useState("");
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ item_id: "", qty: "", unit_cost: "", uid: crypto.randomUUID() }]);
  const setLine = (uid, k, v) => setLines((p) => p.map((l) => (l.uid === uid ? { ...l, [k]: v } : l)));

  const submit = async () => {
    const body = {
      supplier, notes, expected_date: expected || null,
      lines: lines.filter((l) => l.item_id && parseFloat(l.qty) > 0)
        .map((l) => ({ item_id: l.item_id, qty: parseFloat(l.qty), unit_cost: parseFloat(l.unit_cost) || 0 })),
    };
    if (body.lines.length === 0) return toast.error("Add at least one line");
    try {
      await api.post("/inventory/purchase-orders", body);
      toast.success("Purchase order created"); onDone();
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };

  return (
    <Modal title="New Purchase Order" onClose={onClose} testid="po-modal">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[10px] font-mono uppercase text-[var(--muted)]">Supplier</label>
          <input data-testid="po-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} className={`${inputCls} mt-1`} />
        </div>
        <div>
          <label className="text-[10px] font-mono uppercase text-[var(--muted)]">Expected date</label>
          <input data-testid="po-expected" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className={`${inputCls} mt-1`} />
        </div>
      </div>
      <label className="text-[10px] font-mono uppercase text-[var(--muted)]">Lines — qty is in the item's PURCHASE unit</label>
      <div className="mt-1 mb-2">
        {lines.map((l, i) => (
          <div key={l.uid} className="grid grid-cols-[1fr_80px_90px_32px] gap-2 mb-2" data-testid={`po-line-${i}`}>
            <select data-testid={`po-line-item-${i}`} value={l.item_id} onChange={(e) => setLine(l.uid, "item_id", e.target.value)} className={inputCls}>
              <option value="">— item —</option>
              {items.map((x) => <option key={x.id} value={x.id}>{x.name}{x.purchase_unit_symbol ? ` (${x.purchase_unit_symbol})` : ""}</option>)}
            </select>
            <input data-testid={`po-line-qty-${i}`} type="number" min="0" step="any" value={l.qty} onChange={(e) => setLine(l.uid, "qty", e.target.value)} placeholder="qty" className={inputCls} />
            <input data-testid={`po-line-cost-${i}`} type="number" min="0" step="any" value={l.unit_cost} onChange={(e) => setLine(l.uid, "unit_cost", e.target.value)} placeholder="HKD/unit" className={inputCls} />
            <button data-testid={`po-line-del-${i}`} onClick={() => setLines((p) => p.filter((x) => x.uid !== l.uid))} className="text-[var(--muted)] hover:text-[var(--rose)]"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      <button data-testid="po-add-line" onClick={() => setLines((p) => [...p, { item_id: "", qty: "", unit_cost: "", uid: crypto.randomUUID() }])}
        className="w-full py-2 rounded-lg border border-dashed border-[var(--border)] text-[10px] font-mono uppercase text-[var(--muted)] hover:text-[var(--cyan)] hover:border-[var(--cyan)] mb-3">
        + Add line
      </button>
      <label className="text-[10px] font-mono uppercase text-[var(--muted)]">Notes</label>
      <input data-testid="po-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputCls} mt-1 mb-4`} />
      <button data-testid="po-submit" onClick={submit} className="btn-neon w-full py-2.5 rounded-lg text-xs uppercase">Create PO</button>
    </Modal>
  );
}
