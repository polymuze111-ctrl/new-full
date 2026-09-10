import { useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";

/**
 * Floorplan drag-to-reposition logic: pointer down/move/up handlers that
 * live-update table x/y locally and persist on release.
 */
export function useTableDrag(editMode, tables, setTables) {
  const [drag, setDrag] = useState(null);

  const onDown = (e, t) => {
    if (!editMode) return;
    const rect = e.currentTarget.parentElement.getBoundingClientRect();
    setDrag({ id: t.id, startX: e.clientX, startY: e.clientY, x0: t.x, y0: t.y, rect });
  };

  const onMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setTables((ts) =>
      ts.map((t) => (t.id === drag.id ? { ...t, x: Math.max(0, drag.x0 + dx), y: Math.max(0, drag.y0 + dy) } : t))
    );
  };

  const onUp = async () => {
    if (!drag) return;
    const t = tables.find((x) => x.id === drag.id);
    setDrag(null);
    if (!t) return;
    try {
      await api.patch(`/tables/${t.id}`, { x: t.x, y: t.y });
    } catch {
      toast.error("Failed to save position");
    }
  };

  return { onDown, onMove, onUp };
}
