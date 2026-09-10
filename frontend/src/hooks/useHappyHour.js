import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

/**
 * Shared happy-hour state: polls /happy-hours/active every 60s and exposes
 * hhFor (best % off for a product) + hhPrice (discounted price).
 */
export function useHappyHour() {
  const [activeHH, setActiveHH] = useState([]);

  useEffect(() => {
    let live = true;
    const load = () =>
      api.get("/happy-hours/active")
        .then((r) => live && setActiveHH(r.data.active || []))
        .catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const hhFor = useCallback((p) => {
    if (!p?.happy_hour_eligible) return 0;
    let best = 0;
    for (const h of activeHH) {
      if ((h.category_ids || []).includes(p.category_id)) {
        best = Math.max(best, h.percent_off || 0);
      }
    }
    return best;
  }, [activeHH]);

  const hhPrice = useCallback((p, base = p.price) => {
    const pct = hhFor(p);
    return pct ? +(base * (1 - pct / 100)).toFixed(2) : base;
  }, [hhFor]);

  return { activeHH, hhFor, hhPrice };
}
