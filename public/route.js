/**
 * Maps links for a day on the plan.
 *
 * The origin is where you are. Pass one and it goes in the URL; pass nothing
 * and it is left out, which Apple reads as "current location" and Google
 * treats as a blank field for you to fill. Leaving it out is the fallback, not
 * the goal: an explicit origin is what actually gets you routed from where you
 * are standing.
 *
 * Only stops with coordinates go in. A stop without them would either be
 * dropped silently or sent as a text query that can fail the whole route, so
 * the caller is told how many were left out instead.
 */

export const hasPlace = (s) =>
  !!s && typeof s.lat === "number" && typeof s.lon === "number";

const pt = (s) => `${s.lat},${s.lon}`;

// Google's free URL API takes about nine waypoints besides the destination.
export const MAX_WAYPOINTS = 8;

/**
 * @param {object[]} stops   in visiting order; anything without coordinates is skipped
 * @param {"transit"|"walking"} [mode]
 * @returns {{google:string, apple:string, used:number, skipped:number,
 *            capped:boolean} | null}  null when there is nothing to route
 */
export function routeLinks(stops, mode = "transit", origin = null) {
  const all = Array.isArray(stops) ? stops : [];
  const usable = all.filter(hasPlace);
  const skipped = all.length - usable.length;

  // One stop is still worth a link — it is directions to the next thing.
  if (!usable.length) return null;

  const destination = usable[usable.length - 1];
  const waypoints = usable.slice(0, -1);
  const capped = waypoints.length > MAX_WAYPOINTS;

  const from = hasPlace(origin) ? origin : null;

  const google =
    "https://www.google.com/maps/dir/?api=1" +
    (from ? `&origin=${encodeURIComponent(pt(from))}` : "") +
    `&destination=${encodeURIComponent(pt(destination))}` +
    (waypoints.length
      ? `&waypoints=${encodeURIComponent(
          waypoints.slice(0, MAX_WAYPOINTS).map(pt).join("|"))}`
      : "") +
    `&travelmode=${mode === "walking" ? "walking" : "transit"}`;

  const apple =
    "https://maps.apple.com/?" +
    (from ? `saddr=${encodeURIComponent(pt(from))}&` : "") +
    `daddr=${encodeURIComponent(usable.map(pt).join(" to:"))}` +
    `&dirflg=${mode === "walking" ? "w" : "r"}`;

  return { google, apple, used: usable.length, skipped, capped, from: !!from };
}

/** The rest of the day: this stop and everything after it. */
export function routeFrom(stops, index, mode = "transit", origin = null) {
  const all = Array.isArray(stops) ? stops : [];
  if (index < 0 || index >= all.length) return null;
  return routeLinks(all.slice(index), mode, origin);
}

/**
 * A rough guess at how long it takes to get from one stop to the next, in
 * minutes: on foot when it is near, otherwise by public transport at a city
 * average. The straight-line distance times a detour factor — no roads, no
 * timetables, no traffic. Enough to say "that day doesn't add up", never
 * enough to plan a connection by. Null when either end has no location.
 */
export function travelMinutes(a, b) {
  if (!hasPlace(a) || !hasPlace(b)) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(h)) * 1.35;   // detour: streets are not straight
  if (km < 0.05) return 0;
  if (km <= 1.5) return Math.max(3, Math.round((km / 4.5) * 60));           // walking, 4.5 km/h
  return Math.round(10 + (km / 18) * 60);                                   // transit: a wait, then ~18 km/h door to door
}
