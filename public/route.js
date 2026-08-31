/**
 * Maps links for a day on the plan.
 *
 * The origin is deliberately left out of both URLs: Google and Apple then start
 * from wherever the device is. That is what you want when you are standing in
 * London holding a phone — and it means there is no "where are we starting
 * from" to configure or keep in sync.
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
export function routeLinks(stops, mode = "transit") {
  const all = Array.isArray(stops) ? stops : [];
  const usable = all.filter(hasPlace);
  const skipped = all.length - usable.length;

  // One stop is still worth a link — it is directions to the next thing.
  if (!usable.length) return null;

  const destination = usable[usable.length - 1];
  const waypoints = usable.slice(0, -1);
  const capped = waypoints.length > MAX_WAYPOINTS;

  const google =
    "https://www.google.com/maps/dir/?api=1" +
    `&destination=${encodeURIComponent(pt(destination))}` +
    (waypoints.length
      ? `&waypoints=${encodeURIComponent(
          waypoints.slice(0, MAX_WAYPOINTS).map(pt).join("|"))}`
      : "") +
    `&travelmode=${mode === "walking" ? "walking" : "transit"}`;

  const apple =
    "https://maps.apple.com/?" +
    `daddr=${encodeURIComponent(usable.map(pt).join(" to:"))}` +
    `&dirflg=${mode === "walking" ? "w" : "r"}`;

  return { google, apple, used: usable.length, skipped, capped };
}

/** The rest of the day: this stop and everything after it. */
export function routeFrom(stops, index, mode = "transit") {
  const all = Array.isArray(stops) ? stops : [];
  if (index < 0 || index >= all.length) return null;
  return routeLinks(all.slice(index), mode);
}
