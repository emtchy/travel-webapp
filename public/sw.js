/**
 * The service worker: what makes the app usable without signal.
 *
 * Every GET goes to the network first and, if it answers, a copy is kept.
 * When the network is gone the copy is served instead, marked with the time
 * it was made, so the page can say "Offline · as of Tuesday 14:32". That is
 * the whole strategy: online you always see the live thing, exactly as
 * before; offline you see the last thing you saw. No versions to bump,
 * nothing to expire — a fresh answer replaces the old one every time.
 *
 * Photos are the exception: they are cached on first sight and served from
 * the cache from then on, because a picture of the Tower does not change.
 *
 * Writes (POST) are never cached and never queued: offline they fail, and
 * the page says so. A plan edited blind by two people and merged later is
 * worse than a plan you cannot edit for an hour.
 */

const CACHE = "trip-snapshot";
const PHOTO_HOSTS = ["upload.wikimedia.org", "thumb.wikimedia.org"];

self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });

/** Stamp a stored response with when it was stored, so a page can tell. */
async function stamped(response) {
  const headers = new Headers(response.headers);
  headers.set("x-snapshot-at", String(Date.now()));
  const body = await response.clone().arrayBuffer();
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (PHOTO_HOSTS.includes(url.host)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === "opaque") cache.put(req, res.clone());
        return res;
      } catch { return hit || Response.error(); }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      // Keep pages, files and trip answers; not errors, not redirects (a
      // redirect kept would replay a stale sign-in), not the sign-in flow.
      if (res.ok && res.type === "basic" && !url.pathname.startsWith("/auth") && !url.pathname.startsWith("/invite")
          && !url.pathname.startsWith("/api/auth/") && !url.pathname.startsWith("/api/templates")) {
        cache.put(req, await stamped(res));
      }
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: url.pathname.startsWith("/api/trips") });
      if (hit) return hit;
      // A trip page never seen before while offline: the shell can still
      // draw a message if the files are here.
      if (req.mode === "navigate") {
        const m = url.pathname.match(/^\/t\/\d+\/(plan|bookings|details)?/);
        const file = m ? `/${m[1] ?? "index"}.html` : url.pathname === "/" ? "/home.html" : null;
        const page = file && await cache.match(new Request(new URL(file, url.origin)));
        if (page) return page;
      }
      return new Response(JSON.stringify({ error: "You're offline, and this hasn't been saved for offline yet." }),
        { status: 503, headers: { "content-type": "application/json; charset=utf-8" } });
    }
  })());
});

/** "Save for offline": the page tells us what to fetch and keep, now. */
self.addEventListener("message", (e) => {
  if (e.data?.type !== "save") return;
  const urls = Array.isArray(e.data.urls) ? e.data.urls : [];
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let ok = 0, failed = 0;
    for (const u of urls) {
      try {
        const url = new URL(u, self.location.origin);
        const req = new Request(url.href, { mode: PHOTO_HOSTS.includes(url.host) ? "no-cors" : "same-origin", credentials: "same-origin" });
        const res = await fetch(req);
        if (res.ok || res.type === "opaque") { await cache.put(req, url.origin === self.location.origin ? await stamped(res) : res); ok++; }
        else failed++;
      } catch { failed++; }
    }
    e.source?.postMessage({ type: "saved", ok, failed, at: Date.now() });
  })());
});
