import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtHKD } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Move, Edit3, Check, MoonStar, CreditCard } from "lucide-react";
import { ReservationModal, TableActionModal } from "@/components/pos/Reservations";
import { QRCode as QRModal } from "@/components/pos/QRCode";
import PreauthModal from "@/components/pos/PreauthModal";
import TableCard from "@/components/pos/floorplan/TableCard";
import { FloorplanKpiBar, StatusLegend, FloorplanSidebar, SportsTicker } from "@/components/pos/floorplan/FloorplanSections";

export default function Floorplan() {
  const [areas, setAreas] = useState([]);
  const [activeArea, setActiveArea] = useState(null);
  const [tables, setTables] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [drag, setDrag] = useState(null);
  const [activeHH, setActiveHH] = useState([]);
  const [now, setNow] = useState(new Date());
  const [selTable, setSelTable] = useState(null);
  const [reserveTable, setReserveTable] = useState(null);
  const [qrTable, setQrTable] = useState(null);
  const [preauthTable, setPreauthTable] = useState(null);
  const [comboHints, setComboHints] = useState({});  // { table_id: [hints...] }
  const nav = useNavigate();

  const load = useCallback(async () => {
    const a = (await api.get("/areas")).data;
    setAreas(a);
    setActiveArea((cur) => cur || a[0]?.id || null);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const loadHH = () => api.get("/happy-hours/active").then((r) => setActiveHH(r.data.active || []));
    loadHH();
    const hh = setInterval(loadHH, 60000);
    const clk = setInterval(() => setNow(new Date()), 30000);
    return () => { clearInterval(hh); clearInterval(clk); };
  }, []);
  useEffect(() => {
    if (!activeArea) return;
    const fetchArea = () => api.get("/tables", { params: { area_id: activeArea } }).then((r) => setTables(r.data));
    fetchArea();
    const t = setInterval(fetchArea, 5000);
    return () => clearInterval(t);
  }, [activeArea]);

  // ---- business KPIs across ALL tables ----
  const [allTables, setAllTables] = useState([]);
  useEffect(() => {
    const fetchAll = () => api.get("/tables").then((r) => setAllTables(r.data));
    fetchAll();
    const t = setInterval(fetchAll, 10000);
    return () => clearInterval(t);
  }, []);

  // ---- Combo heat-map: 1-more-away upsell hints per table ----
  const fpShownRef = useRef(new Map()); // key -> {table_id, order_id, combo_name, product_id, product_name, potential_discount}
  useEffect(() => {
    const fetchHints = () => api.get("/floorplan/combo-hints").then((r) => {
      const map = {};
      const seenKeys = new Set();
      (r.data || []).forEach((row) => {
        map[row.table_id] = row.hints;
        row.hints.forEach((h) => {
          const k = `${row.order_id}-${h.combo_name}-${h.product_id}`;
          seenKeys.add(k);
          if (!fpShownRef.current.has(k)) {
            const meta = {
              order_id: row.order_id, table_id: row.table_id,
              combo_name: h.combo_name, product_id: h.product_id,
              product_name: h.product_name, potential_discount: h.discount,
              source: "floorplan",
            };
            fpShownRef.current.set(k, meta);
            api.post("/upsell/log", { ...meta, status: "shown" }).catch(() => {});
          }
        });
      });
      setComboHints(map);
      // Anything previously shown that's no longer in the feed = dismissed
      for (const [k, meta] of [...fpShownRef.current.entries()]) {
        if (!seenKeys.has(k)) {
          api.post("/upsell/log", { ...meta, status: "dismissed" }).catch(() => {});
          fpShownRef.current.delete(k);
        }
      }
    }).catch(() => {});
    fetchHints();
    const t = setInterval(fetchHints, 8000);
    return () => clearInterval(t);
  }, []);

  const stats = useMemo(() => {
    const occupied = allTables.filter(t => t.status === "occupied");
    const covers = occupied.reduce((s, t) => s + (t.current_order?.guests || 0), 0);
    const due = occupied.reduce((s, t) => s + (t.current_order?.total || 0), 0);
    const free = allTables.filter(t => t.status === "available").length;
    const over30 = occupied.filter(t => {
      const op = t.current_order?.opened_at;
      if (!op) return false;
      const mins = (Date.now() - new Date(op).getTime()) / 60000;
      return mins > 30;
    }).length;
    // Day open: HK time between 11:00 and 06:00 next day
    const hkStr = new Date().toLocaleString("en-GB", { timeZone: "Asia/Hong_Kong", hour12: false, hour: "2-digit", minute: "2-digit" });
    const [hh] = hkStr.split(":").map(Number);
    const open = hh >= 11 || hh < 6;
    return { covers, due, free, over30, openTables: occupied.length, dayOpen: open };
  }, [allTables, now]);
  // ---- end KPIs ----

  const totals = tables.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});

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

  const addTable = async () => {
    const name = prompt("Table name / label?");
    if (!name) return;
    const seats = parseInt(prompt("Seats?", "4") || "4", 10);
    const doc = await api.post("/tables", {
      area_id: activeArea, name, seats, x: 40, y: 40, width: 90, height: 90, shape: "rect",
    });
    setTables((t) => [...t, doc.data]);
  };

  const delTable = async (id) => {
    if (!confirm("Delete this table?")) return;
    await api.delete(`/tables/${id}`);
    setTables((t) => t.filter((x) => x.id !== id));
  };

  const openTable = (t) => {
    if (editMode) return;
    setSelTable(t);
  };

  const goToOrder = (t) => {
    setSelTable(null);
    if (t.current_order_id) nav(`/register?order=${t.current_order_id}&table=${t.id}`);
    else nav(`/register?table=${t.id}&area=${activeArea}`);
  };

  const cancelReservation = async (t) => {
    if (!confirm(`Cancel reservation for ${t.reservation?.guest_name}?`)) return;
    try {
      await api.delete(`/reservations/${t.reservation.id}`);
      toast.success("Reservation cancelled");
      setSelTable(null);
      const r = await api.get("/tables", { params: { area_id: activeArea } });
      setTables(r.data);
    } catch { toast.error("Failed"); }
  };

  const mergeInto = async (target) => {
    const srcOrderId = selTable?.current_order?.id;
    const tgtOrderId = target?.current_order?.id;
    if (!srcOrderId || !tgtOrderId) return toast.error("Both tabs must be open");
    try {
      const r = await api.post("/orders/merge", { source_id: srcOrderId, target_id: tgtOrderId });
      toast.success(`Merged into Table ${target.name} · ${r.data.line_count} lines · ${fmtHKD(r.data.total)}`);
      setSelTable(null);
      const [a, all] = await Promise.all([
        api.get("/tables", { params: { area_id: activeArea } }),
        api.get("/tables"),
      ]);
      setTables(a.data); setAllTables(all.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Merge failed"); }
  };

  const autoCloseAll = async () => {
    const openTabs = allTables.filter(t => t.status === "occupied").length;
    if (openTabs === 0) return toast.info("No open tabs");
    if (!confirm(`Auto-close ${openTabs} open tab(s) as paid-by-card? This can't be undone.`)) return;
    try {
      const r = await api.post("/orders/auto-close", { method: "card", note: "Last call · Floorplan auto-close" });
      toast.success(`Auto-closed ${r.data.closed} tab(s) · ${fmtHKD(r.data.revenue)}`);
      const [a, all] = await Promise.all([
        api.get("/tables", { params: { area_id: activeArea } }),
        api.get("/tables"),
      ]);
      setTables(a.data); setAllTables(all.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const openPreauth = async (payload) => {
    try {
      const r = await api.post("/tabs/preauth", payload);
      toast.success(`Preauth tab opened for ${payload.customer_name}`);
      setPreauthTable(null);
      const [a, all] = await Promise.all([
        api.get("/tables", { params: { area_id: activeArea } }),
        api.get("/tables"),
      ]);
      setTables(a.data); setAllTables(all.data);
      nav(`/register?order=${r.data.id}${payload.table_id ? `&table=${payload.table_id}` : ""}`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Business KPI bar */}
      <FloorplanKpiBar stats={stats} />

      {/* Sports ticker */}
      <SportsTicker />

      <div className="flex items-center gap-3 mb-4">
        <h1 className="font-display text-2xl font-black" data-testid="page-title">Floorplan</h1>
        <div className="ml-auto flex items-center gap-2">
          {areas.map((a) => (
            <button
              key={a.id}
              data-testid={`area-tab-${a.name}`}
              onClick={() => setActiveArea(a.id)}
              className={`px-4 py-2 rounded-lg font-mono text-xs uppercase tracking-widest border ${
                activeArea === a.id
                  ? "bg-[var(--cyan)] text-black border-transparent"
                  : "bg-[var(--surface)] text-white border-[var(--border)] hover:border-[var(--cyan)]"
              }`}
            >
              {a.name}
            </button>
          ))}
          <button
            data-testid="btn-edit-mode"
            onClick={() => setEditMode((m) => !m)}
            className={`px-4 py-2 rounded-lg font-mono text-xs uppercase tracking-widest border flex items-center gap-2 ${
              editMode
                ? "bg-[var(--amber)] text-black border-transparent"
                : "bg-[var(--surface)] text-white border-[var(--border)]"
            }`}
          >
            {editMode ? <Check size={14} /> : <Edit3 size={14} />}
            {editMode ? "Done" : "Edit"}
          </button>
          {editMode && (
            <button data-testid="btn-add-table" onClick={addTable} className="btn-neon px-4 py-2 rounded-lg text-xs uppercase flex items-center gap-2">
              <Plus size={14} /> Add Table
            </button>
          )}
          <button data-testid="btn-auto-close" onClick={autoCloseAll}
            className="px-4 py-2 rounded-lg font-mono text-xs uppercase tracking-widest border border-[var(--rose)] bg-[var(--rose)]/10 text-[var(--rose)] flex items-center gap-2 hover:bg-[var(--rose)]/20"
            title="Batch-settle every open tab at last call">
            <MoonStar size={14} /> Last Call · Auto-Close
          </button>
          <button data-testid="btn-preauth-tab" onClick={() => setPreauthTable({ id: null, name: "Bar" })}
            className="px-4 py-2 rounded-lg font-mono text-xs uppercase tracking-widest border border-[var(--cyan)] bg-[var(--cyan)]/10 text-[var(--cyan)] flex items-center gap-2 hover:bg-[var(--cyan)]/20"
            title="Open a card-on-file tab so guests can't walk out">
            <CreditCard size={14} /> Preauth Tab
          </button>
        </div>
      </div>

      <StatusLegend totals={totals} />

      <div className="flex-1 flex gap-3 min-h-0">
        <div
          className="flex-1 relative rounded-xl border border-[var(--border)] bg-[var(--surface)] grid-bg overflow-auto"
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
          data-testid="floorplan-canvas"
        >
          {tables.map((t) => (
            <TableCard key={t.id} table={t} hint={comboHints[t.id]?.[0]}
              editMode={editMode} onDown={onDown} openTable={openTable} delTable={delTable} />
          ))}
          {editMode && (
            <div className="absolute bottom-4 left-4 bg-black/70 px-3 py-2 rounded-lg text-xs font-mono flex items-center gap-2">
              <Move size={14} /> Drag tables to reposition
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <FloorplanSidebar activeHH={activeHH} />
      </div>

      {selTable && (
        <TableActionModal
          table={selTable}
          onClose={() => setSelTable(null)}
          onOpen={() => goToOrder(selTable)}
          onReserve={() => { setReserveTable(selTable); setSelTable(null); }}
          onCancel={() => cancelReservation(selTable)}
          onQR={() => { setQrTable(selTable); setSelTable(null); }}
          onMerge={mergeInto}
          otherOccupied={allTables.filter(t => t.status === "occupied" && t.id !== selTable.id)}
        />
      )}
      {reserveTable && (
        <ReservationModal
          table={reserveTable}
          onClose={() => setReserveTable(null)}
          onSaved={async () => {
            setReserveTable(null);
            const r = await api.get("/tables", { params: { area_id: activeArea } });
            setTables(r.data);
          }}
        />
      )}
      {qrTable && <QRModal table={qrTable} onClose={() => setQrTable(null)} />}
      {preauthTable && (
        <PreauthModal table={preauthTable.id ? preauthTable : null}
          onClose={() => setPreauthTable(null)} onOpened={openPreauth} />
      )}
    </div>
  );
}
