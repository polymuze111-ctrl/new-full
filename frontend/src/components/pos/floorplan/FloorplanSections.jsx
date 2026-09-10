import { useEffect, useState } from "react";
import { api, fmtHKD } from "@/lib/api";
import { Users as UsersIcon, Sparkles, Clock, DollarSign, AlertCircle, Radio, Trophy, Target, Check } from "lucide-react";

export const STATUS_LABELS = {
  available: "Available",
  occupied: "Occupied",
  bill_requested: "Bill Requested",
  dirty: "Needs Cleaning",
  reserved: "Reserved",
};
export const STATUS_COLORS = {
  available: "table-available",
  occupied: "table-occupied",
  bill_requested: "table-bill",
  dirty: "table-dirty",
  reserved: "table-reserved",
};

export function Kpi({ label, value, icon: Icon, testid, color = "#00F2FE" }) {
  return (
    <div data-testid={testid} className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${color}18` }}>
        <Icon size={16} style={{ color }} />
      </div>
      <div>
        <div className="text-[10px] font-mono uppercase text-[var(--muted)]">{label}</div>
        <div className="font-display font-black text-lg text-white leading-tight">{value}</div>
      </div>
    </div>
  );
}

export function SidebarCard({ title, icon: Icon, color, testid, children }) {
  return (
    <div data-testid={testid} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--border)] flex items-center gap-2">
        <Icon size={14} style={{ color }} />
        <div className="text-xs font-mono uppercase tracking-widest">{title}</div>
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  );
}

/** Business KPI strip across ALL tables. */
export function FloorplanKpiBar({ stats }) {
  return (
    <div className="mb-3 grid grid-cols-6 gap-2">
      <Kpi label="Covers" value={stats.covers} icon={UsersIcon} testid="kpi-covers" />
      <Kpi label="Open Tables" value={stats.openTables} icon={Radio} testid="kpi-open" color="#F59E0B" />
      <Kpi label="$ Due" value={fmtHKD(stats.due)} icon={DollarSign} testid="kpi-due" color="#FFB800" />
      <Kpi label="Free Tables" value={stats.free} icon={Check} testid="kpi-free" color="#10B981" />
      <Kpi label=">30m Sessions" value={stats.over30} icon={Clock} testid="kpi-over30" color="#F43F5E" />
      <div data-testid="kpi-day" className={`p-3 rounded-xl border flex items-center gap-2 ${stats.dayOpen ? "border-[var(--emerald)] bg-[var(--emerald)]/10" : "border-[var(--rose)] bg-[var(--rose)]/10"}`}>
        <span className={`w-2 h-2 rounded-full ${stats.dayOpen ? "bg-[var(--emerald)]" : "bg-[var(--rose)]"}`} style={{ boxShadow: stats.dayOpen ? "0 0 12px #10b981" : "0 0 12px #f43f5e" }} />
        <div>
          <div className="text-[10px] font-mono uppercase text-[var(--muted)]">Day</div>
          <div className={`font-display font-black ${stats.dayOpen ? "text-[var(--emerald)]" : "text-[var(--rose)]"}`}>
            {stats.dayOpen ? "OPEN" : "CLOSED"}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Table-status count legend. */
export function StatusLegend({ totals }) {
  return (
    <div className="grid grid-cols-5 gap-3 mb-4">
      {["available", "occupied", "bill_requested", "dirty", "reserved"].map((s) => (
        <div key={s} className={`rounded-lg border p-3 ${STATUS_COLORS[s]}`}>
          <div className="text-[10px] font-mono uppercase tracking-widest opacity-80">{STATUS_LABELS[s]}</div>
          <div className="text-3xl font-display font-black">{totals[s] || 0}</div>
        </div>
      ))}
    </div>
  );
}

/** Right-hand sidebar: live promotions, items to push, announcements. */
export function FloorplanSidebar({ activeHH }) {
  return (
    <aside className="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto">
      <SidebarCard title="Active Promotions" icon={Sparkles} color="#FFB800" testid="sidebar-promos">
        {activeHH.length === 0 ? (
          <div className="text-[var(--muted)] text-xs">No live happy hours right now</div>
        ) : (
          activeHH.map(h => (
            <div key={h.id} className="text-xs">
              <div className="flex items-center gap-1">
                <span className="pulse-dot" style={{ background: "#FFB800", boxShadow: "0 0 8px #FFB800" }} />
                <span className="font-semibold">{h.name}</span>
                <span className="ml-auto font-mono text-[var(--amber)] font-bold">-{h.percent_off}%</span>
              </div>
              <div className="text-[10px] font-mono text-[var(--muted)] mt-0.5">
                ends {h.end_time} · {h.category_ids?.length || 0} categor{h.category_ids?.length === 1 ? "y" : "ies"}
              </div>
            </div>
          ))
        )}
      </SidebarCard>
      <SidebarCard title="Items to Push" icon={Trophy} color="#00F2FE" testid="sidebar-push">
        <PushList />
      </SidebarCard>
      <SidebarCard title="Announcements" icon={AlertCircle} color="#A855F7" testid="sidebar-announce">
        <div className="text-xs space-y-1.5">
          <div className="flex items-start gap-1.5"><span className="text-[var(--purple)]">·</span><span>Trivia Night tonight 21:00 — reserve BACKROOM</span></div>
          <div className="flex items-start gap-1.5"><span className="text-[var(--purple)]">·</span><span>New craft IPA on tap · promote to VIPs</span></div>
          <div className="flex items-start gap-1.5"><span className="text-[var(--purple)]">·</span><span>Darts league semifinals Saturday</span></div>
        </div>
      </SidebarCard>
    </aside>
  );
}

function PushList() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api.get("/products").then(r => {
      const picks = r.data.filter(p => p.happy_hour_eligible).slice(0, 5);
      setItems(picks);
    });
  }, []);
  if (!items.length) return <div className="text-[var(--muted)] text-xs">Nothing flagged to push</div>;
  return items.map(p => (
    <div key={p.id} className="text-xs flex items-center gap-2">
      <Target size={10} className="text-[var(--cyan)]" />
      <span className="flex-1 truncate">{p.name}</span>
      <span className="font-mono text-[var(--amber)]">{fmtHKD(p.price)}</span>
    </div>
  ));
}

const TICKER_GAMES = [
  { league: "EPL", match: "Man Utd vs Arsenal", time: "TV1 · 20:00", live: true },
  { league: "NBA", match: "Lakers vs Warriors", time: "TV2 · 22:30", live: true },
  { league: "F1", match: "Bahrain Grand Prix", time: "TV3 · Tomorrow 21:00", live: false },
  { league: "UFC", match: "Fight Night 251", time: "TV4 · Sat 09:00", live: false },
  { league: "AFL", match: "Melbourne vs Sydney", time: "TV5 · Sun 12:00", live: false },
  { league: "MLB", match: "Yankees vs Red Sox", time: "TV6 · Late", live: false },
];

export function SportsTicker() {
  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-stretch">
        <div className="px-3 py-2 bg-[var(--rose)]/20 border-r border-[var(--rose)]/40 flex items-center gap-2 shrink-0">
          <span className="pulse-dot" style={{ background: "#F43F5E", boxShadow: "0 0 12px #F43F5E" }} />
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--rose)] font-bold">Live · Sports</span>
        </div>
        <div className="flex-1 overflow-hidden relative">
          <div className="flex gap-6 py-2 px-3 whitespace-nowrap animate-[ticker_45s_linear_infinite]">
            {[...TICKER_GAMES, ...TICKER_GAMES].map((g, i) => (
              <div key={`${g.league}-${g.match}-${i < TICKER_GAMES.length ? "a" : "b"}`} className="flex items-center gap-2 text-xs">
                {g.live && <span className="w-1.5 h-1.5 rounded-full bg-[var(--rose)]" />}
                <span className="font-mono uppercase text-[var(--cyan)] font-bold">{g.league}</span>
                <span className="text-white">{g.match}</span>
                <span className="font-mono text-[var(--muted)]">{g.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
