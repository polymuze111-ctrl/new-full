import { X } from "lucide-react";

// Shared bits for the inventory tabs/modals.
export const inputCls = "w-full px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-sm outline-none focus:border-[var(--cyan)]";

export const Kpi = ({ label, value, color, testid }) => (
  <div data-testid={testid} className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
    <div className="text-[10px] font-mono uppercase text-[var(--muted)]">{label}</div>
    <div className="font-display font-black text-2xl mt-1" style={{ color }}>{value}</div>
  </div>
);

export function Modal({ title, onClose, children, testid }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div data-testid={testid} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl w-full max-w-lg p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="font-display font-black text-lg">{title}</div>
          <button data-testid={`${testid}-close`} onClick={onClose} className="text-[var(--muted)] hover:text-white"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
