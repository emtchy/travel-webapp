/**
 * Pull coordinates out of whatever someone pasted.
 *
 * Handles raw coordinates and the URL shapes Google and Apple Maps actually
 * produce — which are numerous, undocumented and inconsistent. Pure and
 * network-free: short links that need a redirect followed are reported via
 * `needsResolving`, and the caller decides whether to fetch.
 */

const plausible = (lat, lon) =>
  Number.isFinite(lat) && Number.isFinite(lon) &&
  lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
  // 0,0 is in the Atlantic and is almost always a parse artefact, not a place.
  !(lat === 0 && lon === 0);

const pair = (a, b) => {
  const lat = Number(a);
  const lon = Number(b);
  return plausible(lat, lon)
    ? { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 }
    : null;
};

/** Hosts whose links are opaque until you follow the redirect. */
const SHORT_HOSTS = new Set([
  "goo.gl", "maps.app.goo.gl", "g.co", "maps.google.com.short",
  "apple.co", "maps.apple", "share.google",
]);

export function isShortMapLink(text) {
  try {
    const u = new URL(String(text).trim());
    if (SHORT_HOSTS.has(u.hostname)) return true;
    // goo.gl/maps/xxx and friends
    return /(^|\.)goo\.gl$/.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * @param {string} text  a URL, or "51.5074, -0.1278"
 * @returns {{lat:number, lon:number, source:string} | null}
 */
export function parseMapLink(text) {
  if (typeof text !== "string") return null;
  const raw = text.trim();
  if (!raw) return null;

  // Bare coordinates, comma or whitespace separated.
  const bare = raw.match(/^(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (bare) {
    const hit = pair(bare[1], bare[2]);
    if (hit) return { ...hit, source: "coordinates" };
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const isGoogle = /(^|\.)google\.[a-z.]+$/.test(host) || host === "maps.google.com";
  const isApple = host.endsWith("apple.com");
  const p = url.searchParams;

  // --- Apple: ?ll=, ?sll=, ?coordinate=, ?daddr=, ?q= when it holds numbers
  if (isApple) {
    for (const key of ["ll", "coordinate", "sll", "daddr", "saddr", "q"]) {
      const v = p.get(key);
      if (!v) continue;
      const m = v.match(/(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
      if (m) {
        const hit = pair(m[1], m[2]);
        if (hit) return { ...hit, source: "apple" };
      }
    }
  }

  // --- Google: /@lat,lng,zoom is the one the browser URL bar shows
  const at = url.pathname.match(/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if (at) {
    const hit = pair(at[1], at[2]);
    // !3d/!4d is the *place* pin; @ is the map centre. Prefer the pin.
    const pin = url.href.match(/!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
    if (pin) {
      const pinned = pair(pin[1], pin[2]);
      if (pinned) return { ...pinned, source: "google" };
    }
    if (hit) return { ...hit, source: "google" };
  }

  const pin = url.href.match(/!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
  if (pin) {
    const hit = pair(pin[1], pin[2]);
    if (hit) return { ...hit, source: "google" };
  }

  // --- query parameters used by both, and by share links
  for (const key of ["q", "query", "ll", "center", "destination", "daddr"]) {
    const v = p.get(key);
    if (!v) continue;
    const m = v.match(/(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
    if (m) {
      const hit = pair(m[1], m[2]);
      if (hit) return { ...hit, source: isGoogle ? "google" : isApple ? "apple" : "link" };
    }
  }

  return null;
}

/**
 * A maps link with a place name but no coordinates — `?q=Harrods`, or
 * `/maps/place/Harrods+London/`. Returns the name so it can be geocoded
 * normally instead of the whole URL being thrown at the search.
 */
export function mapSearchTerm(text) {
  if (typeof text !== "string") return null;
  let url;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const isMaps =
    /(^|\.)google\.[a-z.]+$/.test(host) || host.endsWith("apple.com") ||
    host === "maps.google.com";
  if (!isMaps) return null;

  const clean = (v) => {
    const t = decodeURIComponent(String(v)).replace(/\+/g, " ").trim();
    // A bare coordinate pair is not a name.
    if (!t || /^-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/.test(t)) return null;
    return t.slice(0, 200);
  };

  const place = url.pathname.match(/\/place\/([^/@]+)/);
  if (place) {
    const t = clean(place[1]);
    if (t) return t;
  }
  for (const key of ["q", "query", "address", "name"]) {
    const v = url.searchParams.get(key);
    if (!v) continue;
    const t = clean(v);
    if (t) return t;
  }
  return null;
}
