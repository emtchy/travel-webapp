/**
 * The clock arithmetic behind "does this day add up?" — pure functions over
 * the stops of one day, so the page and the tests share them.
 *
 * Everything here is rough on purpose. A visit length is a guess about the
 * place, the way between two stops is a straight line with a detour factor,
 * and SLACK minutes of grace keep the estimates from crying wolf. The result
 * is one flag per stop and a sum per day; nothing here changes a plan.
 */
import { travelMinutes } from "./route.js";

/** Minutes of grace before an estimate counts as a problem. */
export const SLACK = 10;

/** "HH:MM" → minutes since midnight, or null when there is no clock. */
export function toMin(hhmm) {
  if (typeof hhmm !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/** Minutes since midnight → "HH:MM"; past midnight wraps, as a clock would. */
export function fromMin(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * The times of one day. `stops` are in clock order, each
 * `{ start, end, durationMin, place }` — times as "HH:MM" or null, the
 * length in minutes or null, the place `{ lat, lon }` or anything without.
 *
 * Returns `{ stops, visits, travel, unknown }`; per stop
 * `{ startMin, endMin, implied, flag, by, travel }`:
 *   endMin   the end as entered, or start + length when only a start is known
 *   implied  true when endMin was worked out rather than entered
 *   flag     "overlap" — starts before the previous stop ends
 *            "tight"   — the gap since the previous stop is shorter than the way
 *            "overrun" — the entered slot is shorter than the visit length
 *            null      — nothing to say, or not enough known to say it
 *   by       the minutes behind the flag
 *   travel   the estimated way from the previous stop, or null
 * `visits` sums the slots (entered, else the length), `travel` the ways,
 * `unknown` counts stops with neither an entered end nor a length.
 */
export function dayTimes(stops, travel = travelMinutes) {
  const out = [];
  let visits = 0, ways = 0, unknown = 0;

  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const startMin = toMin(s.start);
    const entered = toMin(s.end);
    const len = Number.isInteger(s.durationMin) && s.durationMin > 0 ? s.durationMin : null;
    const endMin = entered ?? (startMin != null && len ? startMin + len : null);
    const implied = entered == null && endMin != null;

    const r = { startMin, endMin, implied, flag: null, by: 0, travel: null };

    if (startMin != null && entered != null && entered > startMin) visits += entered - startMin;
    else if (len) visits += len;
    if (entered == null && !len) unknown++;

    if (startMin != null && entered != null && len && entered - startMin < len - SLACK) {
      r.flag = "overrun";
      r.by = len - (entered - startMin);
    }

    const prev = out[i - 1];
    if (prev) {
      const tr = travel(stops[i - 1].place, s.place);
      if (tr != null) { r.travel = tr; ways += tr; }
      if (startMin != null && prev.endMin != null) {
        if (startMin < prev.endMin) {
          r.flag = "overlap";
          r.by = prev.endMin - startMin;
        } else if (tr != null && startMin - prev.endMin < tr - SLACK) {
          r.flag = "tight";
          r.by = tr;
        }
      }
    }
    out.push(r);
  }

  return { stops: out, visits, travel: ways, unknown };
}
