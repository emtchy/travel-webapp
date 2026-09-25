/**
 * Sign-in by email link, and the session it starts.
 *
 * The whole of it:
 *
 *   POST /api/auth/request  { email, next?, lang? }
 *       → a one-time token goes to that address, as a link to /auth?token=…
 *   GET  /auth?token=…
 *       → the link. Proves the mailbox; finds or creates the user; starts a
 *         session in an HttpOnly cookie; redirects to `next`.
 *   GET  /api/auth/me       → { user } or { user: null }
 *   POST /api/auth/logout   → ends the session, clears the cookie
 *
 * No passwords. Only hashes of tokens and session ids are stored, so a copy of
 * the database signs nobody in. A token lives fifteen minutes and works once;
 * a session lives thirty days and is extended each time it is used.
 *
 * Mail goes through Resend (RESEND_API_KEY, MAIL_FROM). With no key set —
 * local development, the tests — nothing is sent and the link is returned in
 * the response instead, so the flow can be walked without a mailbox. That
 * branch cannot be reached in production, where the key is set.
 */

import { json, bad } from "./http.js";

const TOKEN_TTL = 15 * 60 * 1000;
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const COOKIE = "trip_session";
const MAX_REQUESTS_PER_HOUR = 5;

/* ------------------------------------------------------------- helpers */

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Lowercased, trimmed, and shaped like an address — or null. */
export function cleanEmail(raw) {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

/** Only a path on this site: "/t/3/plan" yes, "https://elsewhere" no. */
function cleanNext(raw) {
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  if (raw.length > 200) return null;
  return raw;
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function cookieHeader(url, value, maxAge) {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export const displayNameOf = (email) => {
  const local = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  return local.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 32) || "Someone";
};

/* ------------------------------------------------------------- session */

/**
 * The signed-in user for this request, or null. Extends the session as a
 * side effect, so a person who uses the site stays signed in.
 */
export async function currentUser(request, env) {
  const sid = readCookie(request, COOKIE);
  if (!sid) return null;
  const hash = await sha256(sid);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT s.id_hash, s.expires_at, u.id, u.email, u.display_name, u.lang, u.maps, u.pinned_trip_id
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ?1 AND s.expires_at > ?2`
  ).bind(hash, now).first();
  if (!row) return null;

  // Touch it at most once an hour; every request would be a write per click.
  if (row.expires_at - now < SESSION_TTL - 60 * 60 * 1000) {
    await env.DB.prepare(
      "UPDATE sessions SET expires_at = ?1, last_seen = ?2 WHERE id_hash = ?3"
    ).bind(now + SESSION_TTL, now, hash).run();
    await env.DB.prepare("UPDATE users SET last_seen = ?1 WHERE id = ?2").bind(now, row.id).run();
  }
  return { id: row.id, email: row.email, displayName: row.display_name,
           lang: row.lang ?? null, maps: row.maps ?? null, pinnedTripId: row.pinned_trip_id ?? null };
}

/* ------------------------------------------------------------- mail */

const MAIL = {
  en: {
    subject: "Your sign-in link",
    body: (link) => `Open this link to sign in:\n\n${link}\n\nIt works once and expires in 15 minutes. If you didn't ask for it, ignore this email.`,
    html: (link) => `<p>Open this link to sign in:</p><p><a href="${link}">${link}</a></p><p>It works once and expires in 15 minutes. If you didn't ask for it, ignore this email.</p>`,
  },
  de: {
    subject: "Dein Anmeldelink",
    body: (link) => `Öffne diesen Link, um dich anzumelden:\n\n${link}\n\nEr funktioniert einmal und läuft in 15 Minuten ab. Falls du ihn nicht angefordert hast, ignoriere diese E-Mail.`,
    html: (link) => `<p>Öffne diesen Link, um dich anzumelden:</p><p><a href="${link}">${link}</a></p><p>Er funktioniert einmal und läuft in 15 Minuten ab. Falls du ihn nicht angefordert hast, ignoriere diese E-Mail.</p>`,
  },
};

/** One email through Resend. Throws with Resend's answer if it did not go. */
export async function sendMail(env, { to, subject, text, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM || "Trip <onboarding@resend.dev>", to: [to], subject, text, html }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend answered ${res.status}: ${detail.slice(0, 200)}`);
  }
}

/** The user with this address, created if new. Returns { id }. */
export async function findOrCreateUser(env, email, now = Date.now()) {
  let user = await env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(email).first();
  if (user) return user;
  user = { id: `u-${crypto.randomUUID()}` };
  await env.DB.prepare(
    "INSERT INTO users (id, email, display_name, created_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?4)"
  ).bind(user.id, email, displayNameOf(email), now).run();
  return user;
}

/** A new session for the user; returns the Set-Cookie header value. */
export async function startSession(env, userId, url, now = Date.now()) {
  const sid = randomToken();
  await env.DB.prepare(
    "INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?3)"
  ).bind(await sha256(sid), userId, now, now + SESSION_TTL).run();
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(now).run();
  return cookieHeader(url, sid, Math.floor(SESSION_TTL / 1000));
}

/** A small standalone page for the moments a link leads somewhere but the app. */
export const htmlPage = (title, text, home = "/", status = 200) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
background:#F5F5F7;color:#1D1D1F;display:grid;place-items:center;min-height:100dvh;margin:0}
main{text-align:center;padding:24px;max-width:36ch}h1{font-size:22px;margin:0 0 8px}p{color:#5C5C63;margin:0 0 18px}
a{color:#0A66E0;font-weight:600;text-decoration:none}</style>
<main><h1>${title}</h1><p>${text}</p><a href="${home}">Back to the trip</a></main>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

/* ------------------------------------------------------------- handlers */

export async function handleAuthRequest(request, env) {
  let body;
  try { body = await request.json(); } catch { return bad("Body must be JSON."); }

  const email = cleanEmail(body?.email);
  if (!email) return bad("That doesn't look like an email address.");
  const next = cleanNext(body?.next) ?? "/";
  const lang = body?.lang === "de" ? "de" : "en";
  const now = Date.now();

  await env.DB.prepare("DELETE FROM login_tokens WHERE expires_at < ?1").bind(now).run();

  // The answer is the same whether or not anything was sent: an address is
  // not something to confirm to whoever is asking. Past the limit, nothing
  // goes out and the caller is none the wiser.
  const { count } = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM login_tokens WHERE email = ?1 AND created_at > ?2"
  ).bind(email, now - 60 * 60 * 1000).first();
  if (count >= MAX_REQUESTS_PER_HOUR) return json({ ok: true, sent: true });

  const token = randomToken();
  await env.DB.prepare(
    `INSERT INTO login_tokens (token_hash, email, next_path, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  ).bind(await sha256(token), email, next, now, now + TOKEN_TTL).run();

  const link = `${new URL(request.url).origin}/auth?token=${token}`;

  if (!env.RESEND_API_KEY) {
    // Development: no mail, the link comes straight back.
    return json({ ok: true, sent: false, devLink: link });
  }
  try {
    const L = MAIL[lang] ?? MAIL.en;
    await sendMail(env, { to: email, subject: L.subject, text: L.body(link), html: L.html(link) });
  } catch (err) {
    console.error(err.message);
    return bad("The email couldn't be sent. Try again in a moment.", 502);
  }
  return json({ ok: true, sent: true });
}

/** The link in the email. Proves the mailbox, starts the session, moves on. */
export async function handleAuthCallback(request, env, url) {
  const token = url.searchParams.get("token") || "";
  const now = Date.now();
  const fail = () => htmlPage("This link has expired",
    "Sign-in links work once and last fifteen minutes. Ask for a new one from the trip page.", "/", 400);

  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return fail();
  const hash = await sha256(token);
  const row = await env.DB.prepare(
    "SELECT email, next_path, expires_at, used_at FROM login_tokens WHERE token_hash = ?1"
  ).bind(hash).first();
  if (!row || row.used_at || row.expires_at < now) return fail();

  await env.DB.prepare("UPDATE login_tokens SET used_at = ?1 WHERE token_hash = ?2").bind(now, hash).run();

  const user = await findOrCreateUser(env, row.email, now);
  return new Response(null, {
    status: 302,
    headers: {
      location: `${url.origin}${cleanNext(row.next_path) ?? "/"}`,
      "set-cookie": await startSession(env, user.id, url, now),
      "cache-control": "no-store",
    },
  });
}

export async function handleAuthMe(request, env) {
  return json({ user: await currentUser(request, env) });
}

/**
 * POST /api/auth/settings  { displayName?, lang?, maps? }
 * Only the fields sent change. lang and maps take null to mean "follow the
 * device again". Answers with the user as /me would.
 */
export async function handleAuthSettings(request, env) {
  let body;
  try { body = await request.json(); } catch { return bad("Body must be JSON."); }
  const user = await currentUser(request, env);
  if (!user) return bad("Sign in first.", 401);

  const sets = [], args = [];
  if (body?.displayName !== undefined) {
    const name = typeof body.displayName === "string" ? body.displayName.trim().replace(/\s+/g, " ") : "";
    if (name.length < 1 || name.length > 32 || /[\u0000-\u001f\u007f]/.test(name))
      return bad("A name between 1 and 32 characters.");
    sets.push("display_name = ?"); args.push(name);
  }
  if (body?.lang !== undefined) {
    if (body.lang !== null && !["en", "de"].includes(body.lang)) return bad("Language must be en or de.");
    sets.push("lang = ?"); args.push(body.lang);
  }
  if (body?.maps !== undefined) {
    if (body.maps !== null && !["apple", "google"].includes(body.maps)) return bad("Maps must be apple or google.");
    sets.push("maps = ?"); args.push(body.maps);
  }
  if (!sets.length) return bad("Nothing to change.");

  await env.DB.prepare(
    `UPDATE users SET ${sets.map((c, i) => c.replace("?", `?${i + 1}`)).join(", ")} WHERE id = ?${sets.length + 1}`
  ).bind(...args, user.id).run();
  return json({ ok: true, user: await currentUser(request, env) });
}

export async function handleAuthLogout(request, env, url) {
  const sid = readCookie(request, COOKIE);
  if (sid) await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?1").bind(await sha256(sid)).run();
  return new Response(JSON.stringify({ ok: true, user: null }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": cookieHeader(url, "", 0),
    },
  });
}
