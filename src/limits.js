/**
 * Rate limits and the headers every response carries.
 *
 * Limits use Cloudflare's rate-limiting bindings (wrangler.toml,
 * `[[ratelimits]]`): a counter per key, per minute, kept at the edge. Three
 * of them, with separate counters:
 *
 *   RL_AUTH   sign-in and invite mail requests, keyed by address     5 / min
 *   RL_GEO    address lookups, keyed by account — Nominatim asks
 *             for about one call a second from a whole site          10 / min
 *   RL_WRITE  every other write, keyed by account (address if none)  60 / min
 *
 * Where a binding is missing — the tests, an old local config — nothing is
 * limited, so the app never fails closed on its own infrastructure. The
 * hourly caps (trips made, invites sent) are counted in the database, since a
 * binding's window is a minute at most.
 */

import { bad } from "./http.js";

export const ip = (request) => request.headers.get("cf-connecting-ip") || "unknown";

/** null when allowed; a 429 response when not. */
export async function limited(env, binding, key) {
  const rl = env?.[binding];
  if (!rl || typeof rl.limit !== "function") return null;
  let ok = true;
  try { ({ success: ok } = await rl.limit({ key: `${binding}:${key}` })); } catch { ok = true; }
  return ok ? null : bad("Too many requests. Wait a minute and try again.", 429);
}

/**
 * Headers for every response. The pages carry their own inline styles and
 * module scripts, so those stay allowed; everything else is tightened —
 * nothing embeds this site, nothing on it loads from anywhere but itself and
 * Wikipedia (the photos), and forms only post here.
 */
export const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "geolocation=(self), camera=(), microphone=(), payment=()",
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "connect-src 'self' https://en.wikipedia.org https://upload.wikimedia.org",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
};

export function withHeaders(response) {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
}
