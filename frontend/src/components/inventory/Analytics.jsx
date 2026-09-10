import { fmtHKD } from "@/lib/api";
import { Kpi } from "./common";

export function AnalyticsTab({ analytics }) {
  if (!analytics) return null;
  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Kpi label={`Usage value (${analytics.days}d)`} value={fmtHKD(analytics.totals.usage_value)} color="#00F2FE" testid="an-usage" />
        <Kpi label={`Waste + breakage (${analytics.days}d)`} value={fmtHKD(analytics.totals.waste_value)} color="#F43F5E" testid="an-waste" />
        <Kpi label="Restock events" value={analytics.totals.restock_count} color="#10B981" testid="an-restocks" />
      </div>
      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <table className="w-full text-sm" data-testid="analytics-table">
          <thead className="bg-[var(--surface-2)] text-[10px] font-mono uppercase text-[var(--muted)]">
            <tr>
              <th className="text-left px-4 py-2">Item</th><th className="text-right px-4 py-2">Sold</th>
              <th className="text-right px-4 py-2">Wasted</th><th className="text-right px-4 py-2">Usage value</th>
              <th className="text-right px-4 py-2">Waste value</th><th className="text-right px-4 py-2">Days of stock</th>
            </tr>
          </thead>
          <tbody>
            {analytics.rows.map((r) => (
              <tr key={r.item_id} data-testid={`analytics-row-${r.name}`} className="border-t border-[var(--border)] hover:bg-[var(--surface)]">
                <td className="px-4 py-2 font-semibold text-white">{r.name}<span className="ml-2 text-[10px] font-mono text-[var(--muted)]">{r.category}</span></td>
                <td className="px-4 py-2 text-right font-mono text-xs">{r.sold} {r.unit_symbol}</td>
                <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: r.waste > 0 ? "#F43F5E" : "#94A3B8" }}>{r.waste} {r.unit_symbol}</td>
                <td className="px-4 py-2 text-right font-mono text-xs text-[var(--cyan)]">{fmtHKD(r.usage_value)}</td>
                <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: r.waste_value > 0 ? "#F43F5E" : "#94A3B8" }}>{fmtHKD(r.waste_value)}</td>
                <td className="px-4 py-2 text-right font-mono text-xs" style={{ color: r.days_of_stock !== null && r.days_of_stock < 7 ? "#FFB800" : "#94A3B8" }}>
                  {r.days_of_stock === null ? "—" : `${r.days_of_stock}d`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
