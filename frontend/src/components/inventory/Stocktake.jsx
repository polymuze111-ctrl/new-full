import { useState } from "react";
import { api, fmtHKD } from "@/lib/api";
import { toast } from "sonner";
import { ClipboardCheck } from "lucide-react";

export function StocktakeTab({ stocktake, onChanged }) {
  const [counts, setCounts] = useState({});
  const [report, setReport] = useState(null);
  const session = stocktake?.session;
  const lines = stocktake?.lines || [];
  const countedCount = Object.keys(session?.counts || {}).length;

  const start = async () => {
    try { await api.post("/inventory/stocktake/start"); setReport(null); toast.success("Stocktake session started"); onChanged(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };
  const saveCount = async (line) => {
    const raw = counts[line.item_id] ?? line.counted;
    const v = parseFloat(raw);
    if (isNaN(v) || v < 0) return toast.error("Enter the counted quantity");
    await api.post("/inventory/stocktake/count", { item_id: line.item_id, counted: v });
    toast.success(`${line.name}: ${v} ${line.unit_symbol || ""}`); onChanged();
  };
  const close = async () => {
    if (!confirm(`Close stocktake and apply ${countedCount} correction(s)? Stock is set to counted values.`)) return;
    const r = await api.post("/inventory/stocktake/close");
    setReport(r.data.report); toast.success("Stocktake closed — corrections applied"); onChanged();
  };
  const cancelS = async () => {
    if (!confirm("Cancel this session? Counts are discarded.")) return;
    await api.post("/inventory/stocktake/cancel"); onChanged();
  };

  if (report) return (
    <div data-testid="stocktake-report">
      <div className="flex items-center gap-3 mb-3">
        <h3 className="font-display font-bold text-lg">Variance report</h3>
        <button data-testid="btn-dismiss-report" onClick={() => setReport(null)} className="ml-auto py-1.5 px-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[10px] font-mono uppercase text-[var(--muted)]">Dismiss</button>
      </div>
      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-2)] text-[10px] font-mono uppercase text-[var(--muted)]">
            <tr><th className="text-left px-4 py-2">Item</th><th className="text-right px-4 py-2">Expected</th><th className="text-right px-4 py-2">Counted</th><th className="text-right px-4 py-2">Variance</th><th className="text-right px-4 py-2">Value</th></tr>
          </thead>
          <tbody>
            {report.map((r) => (
              <tr key={r.item_id} data-testid={`variance-${r.name}`} className="border-t border-[var(--border)]">
                <td className="px-4 py-2 font-semibold text-white">{r.name}</td>
                <td className="px-4 py-2 text-right font-mono text-xs">{r.expected} {r.unit_symbol}</td>
                <td className="px-4 py-2 text-right font-mono text-xs">{r.counted} {r.unit_symbol}</td>
                <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: r.variance < 0 ? "#F43F5E" : r.variance > 0 ? "#10B981" : "#94A3B8" }}>
                  {r.variance > 0 ? "+" : ""}{r.variance} {r.unit_symbol}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: r.variance_value < 0 ? "#F43F5E" : "#10B981" }}>{fmtHKD(r.variance_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (!session) return (
    <div className="p-10 rounded-xl border border-dashed border-[var(--border)] text-center">
      <ClipboardCheck size={28} className="mx-auto text-[var(--cyan)] mb-3" />
      <div className="text-[var(--muted)] text-sm mb-4">Start a stocktake to snapshot expected stock, walk the shelves, enter counts, then close to apply corrections with a variance report.</div>
      <button data-testid="btn-start-stocktake" onClick={start} className="btn-neon px-6 py-2.5 rounded-lg text-xs uppercase">Start Stocktake</button>
    </div>
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-[var(--amber)]/20 text-[var(--amber)] font-black">session open</span>
        <span className="text-xs font-mono text-[var(--muted)]">started {(session.started_at || "").slice(5, 16).replace("T", " ")} by {session.started_by} · {countedCount}/{lines.length} counted</span>
        <div className="ml-auto flex gap-2">
          <button data-testid="btn-cancel-stocktake" onClick={cancelS} className="py-1.5 px-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[10px] font-mono uppercase text-[var(--muted)]">Cancel</button>
          <button data-testid="btn-close-stocktake" onClick={close} className="btn-neon px-4 py-1.5 rounded-lg text-[10px] uppercase">Close & Apply</button>
        </div>
      </div>
      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <table className="w-full text-sm" data-testid="stocktake-table">
          <thead className="bg-[var(--surface-2)] text-[10px] font-mono uppercase text-[var(--muted)]">
            <tr><th className="text-left px-4 py-2">Item</th><th className="text-right px-4 py-2">Expected</th><th className="text-right px-4 py-2">Counted</th><th className="px-4 py-2"></th></tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.item_id} data-testid={`stocktake-row-${l.name}`} className="border-t border-[var(--border)] hover:bg-[var(--surface)]">
                <td className="px-4 py-2 font-semibold text-white">{l.name}<span className="ml-2 text-[10px] font-mono text-[var(--muted)]">{l.category}</span></td>
                <td className="px-4 py-2 text-right font-mono text-xs text-[var(--muted)]">{l.expected} {l.unit_symbol}</td>
                <td className="px-4 py-2 text-right">
                  <input data-testid={`stocktake-count-${l.item_id}`} type="number" min="0" step="any"
                    value={counts[l.item_id] ?? (l.counted ?? "")}
                    onChange={(e) => setCounts((p) => ({ ...p, [l.item_id]: e.target.value }))}
                    placeholder={String(l.expected)}
                    className="w-28 px-2 py-1 rounded bg-[var(--surface-2)] border border-[var(--border)] text-right font-mono text-xs outline-none focus:border-[var(--cyan)]" />
                </td>
                <td className="px-4 py-2 text-right">
                  <button data-testid={`stocktake-save-${l.item_id}`} onClick={() => saveCount(l)}
                    className="py-1 px-2 rounded bg-[var(--cyan)]/10 border border-[var(--cyan)]/40 text-[10px] font-mono uppercase text-[var(--cyan)]">Save</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
