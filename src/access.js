/**
 * Asking to join: what happens when someone who is signed in but not on a
 * trip tries to change it. Instead of a dead end, the shell offers to ask
 * the trip's owner; the owner sees the request on Details and lets the
 * person in with a role, or declines.
 *
 *   GET  /api/t/<trip>/me                 carries `askable` (an owner with an
 *                                         account exists) and `requested`
 *   POST /api/t/<trip>/access/request     { lang? } — signed in, not on the trip
 *   GET  /api/t/<trip>/access/requests    owner: the open ones (also on /api/sights)
 *   POST /api/t/<trip>/access/decide      owner: { id, role | null }
 *
 * A trip whose owners are all placeholders — the example trip — has nobody
 * to ask, so it is not askable and the button stays off. One open request
 * per person per trip; twenty per trip. With RESEND_API_KEY set, each owner
 * with an account gets a mail; without, nothing is sent and the request
 * simply waits on Details.
 */
import { json, bad } from "./http.js";
import { currentUser, sendMail } from "./auth.js";

const ROLES = ["owner", "editor", "viewer"];

const MAIL = {
  en: {
    subject: (who, trip) => `${who} asks to join ${trip}`,
    text: (who, email, trip, link) => `${who} (${email}) would like to join "${trip}".\n\nOpen the trip's Details page to let them in or decline:\n\n${link}`,
    html: (who, email, trip, link) => `<p>${who} (${email}) would like to join <b>${trip}</b>.</p><p><a href="${link}">Open the trip's Details page</a> to let them in or decline.</p>`,
  },
  de: {
    subject: (who, trip) => `${who} möchte bei ${trip} dabei sein`,
    text: (who, email, trip, link) => `${who} (${email}) möchte bei „${trip}“ dabei sein.\n\nÖffne die Details-Seite der Reise, um die Person aufzunehmen oder abzulehnen:\n\n${link}`,
    html: (who, email, trip, link) => `<p>${who} (${email}) möchte bei <b>${trip}</b> dabei sein.</p><p><a href="${link}">Öffne die Details-Seite der Reise</a>, um die Person aufzunehmen oder abzulehnen.</p>`,
  },
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The owners who could be asked: those with an account. */
async function ownersWithAccounts(env, trip) {
  const { results } = await env.DB.prepare(
    `SELECT u.email, u.lang FROM trip_members m JOIN users u ON u.id = m.user_id
      WHERE m.trip_id = ?1 AND m.role = 'owner'`
  ).bind(trip).all();
  return results ?? [];
}

export async function askable(env, trip) {
  return (await ownersWithAccounts(env, trip)).length > 0;
}

export async function hasRequested(env, trip, userId) {
  if (!userId) return false;
  return !!(await env.DB.prepare(
    "SELECT 1 FROM access_requests WHERE trip_id = ?1 AND user_id = ?2 AND status = 'open'"
  ).bind(trip, userId).first());
}

export async function listRequests(env, trip) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.user_id, r.created_at, u.email, u.display_name
       FROM access_requests r JOIN users u ON u.id = r.user_id
      WHERE r.trip_id = ?1 AND r.status = 'open' ORDER BY r.created_at ASC`
  ).bind(trip).all();
  return (results ?? []).map((r) => ({ id: r.id, email: r.email, name: r.display_name, createdAt: r.created_at }));
}

/** @param ctx { tripName } */
export async function handleAccessRequest(request, env, trip, ctx) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const user = await currentUser(request, env);
  if (!user) return bad("Sign in first.", 401);
  const onTrip = await env.DB.prepare("SELECT 1 FROM trip_members WHERE trip_id = ?1 AND user_id = ?2").bind(trip, user.id).first();
  if (onTrip) return bad("You're already on this trip.");
  const owners = await ownersWithAccounts(env, trip);
  if (!owners.length) return bad("There's nobody to ask on this trip — it's an example. Sign in and plan your own.");
  if (await hasRequested(env, trip, user.id)) return bad("You've already asked. The owner will see it on the trip's Details page.", 409);
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE trip_id = ?1 AND status = 'open'").bind(trip).first();
  if (n >= 20) return bad("This trip has a lot of open requests already. Try again later.", 429);

  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO access_requests (id, trip_id, user_id, status, created_at) VALUES (?1, ?2, ?3, 'open', ?4)"
  ).bind(`r-${crypto.randomUUID()}`, trip, user.id, now).run();

  let sent = false;
  if (env.RESEND_API_KEY) {
    const tripName = await ctx.tripName(env, trip);
    const link = `${new URL(request.url).origin}/t/${trip}/details`;
    const who = user.displayName || user.email;
    for (const o of owners) {
      const L = MAIL[o.lang === "de" ? "de" : body?.lang === "de" ? "de" : "en"];
      try {
        await sendMail(env, { to: o.email, subject: L.subject(who, tripName),
          text: L.text(who, user.email, tripName, link), html: L.html(esc(who), esc(user.email), esc(tripName), link) });
        sent = true;
      } catch (err) { console.error(err.message); }
    }
  }
  return json({ ok: true, requested: true, sent });
}

/** @param ctx { actor } */
export async function handleAccessList(request, env, trip, ctx) {
  const { error } = await ctx.actor(request, env, trip, "own");
  if (error) return error;
  return json({ requests: await listRequests(env, trip) });
}

/**
 * The owner decides: a role lets the person in under their display name
 * (made unique on the trip if it has to be); null declines. Either way the
 * request is closed. Answers with the requests and the snapshot.
 * @param ctx { actor, voterKey, snapshot }
 */
export async function handleAccessDecide(request, env, trip, ctx) {
  let body;
  try { body = await request.json(); } catch { return bad("Body must be JSON."); }
  const { name: by, error } = await ctx.actor(request, env, trip, "own");
  if (error) return error;
  const id = typeof body?.id === "string" ? body.id : "";
  const req = await env.DB.prepare(
    `SELECT r.id, r.user_id, u.display_name, u.email FROM access_requests r JOIN users u ON u.id = r.user_id
      WHERE r.id = ?1 AND r.trip_id = ?2 AND r.status = 'open'`
  ).bind(id, trip).first();
  if (!req) return bad("That request is already answered.", 404);
  const role = body?.role == null ? null : body.role;
  if (role !== null && !ROLES.includes(role)) return bad("A role: owner, editor or viewer — or nothing to decline.");

  const now = Date.now();
  if (role) {
    const already = await env.DB.prepare("SELECT 1 FROM trip_members WHERE trip_id = ?1 AND user_id = ?2").bind(trip, req.user_id).first();
    if (!already) {
      const base = (req.display_name || req.email.split("@")[0]).trim().slice(0, 28) || "Guest";
      let name = base;
      for (let i = 2; i < 100; i++) {
        const taken = await env.DB.prepare("SELECT 1 FROM trip_members WHERE trip_id = ?1 AND name_key = ?2").bind(trip, ctx.voterKey(name)).first();
        if (!taken) break;
        name = `${base} ${i}`;
      }
      await env.DB.prepare(
        `INSERT INTO trip_members (id, trip_id, name, name_key, note, added_by, created_at, user_id, role)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8)`
      ).bind(`m-${crypto.randomUUID()}`, trip, name, ctx.voterKey(name), by, now, req.user_id, role).run();
    }
  }
  await env.DB.prepare("UPDATE access_requests SET status = ?1, decided_at = ?2 WHERE id = ?3")
    .bind(role ? "accepted" : "declined", now, id).run();
  return json({ ok: true, requests: await listRequests(env, trip), ...(await ctx.snapshot(env, trip)) });
}
