/**
 * Invites: how someone gets onto a trip.
 *
 *   POST /api/t/<trip>/invite          { email, role?, memberId? | name?, lang? }
 *       → owner only. Mails a link. `memberId` points at an existing name on
 *         the trip (say, Manuel, who voted before accounts existed) so the
 *         invitee becomes that name and inherits everything under it; `name`
 *         creates a new one; neither means the name comes from the address.
 *   GET  /api/t/<trip>/invites         → owner only: the ones still open
 *   POST /api/t/<trip>/invite/revoke   { id }  → owner only
 *   GET  /invite?token=…
 *       → the link. It was sent to that mailbox, so opening it proves the
 *         mailbox: it signs the person in (creating the account if new), puts
 *         them on the trip with the role, and lands on the trip. One step.
 *
 * An invite lasts seven days and works once. Only a hash of the token is
 * stored. With no RESEND_API_KEY the link comes back in the response, as a
 * sign-in request does.
 */

import { json, bad } from "./http.js";
import { cleanEmail, sha256, randomToken, sendMail, findOrCreateUser, startSession, htmlPage } from "./auth.js";

const INVITE_TTL = 7 * 24 * 60 * 60 * 1000;
export const ROLES = ["owner", "editor", "viewer"];

const MAIL = {
  en: {
    subject: (trip, by) => `${by} invited you to ${trip}`,
    text: (trip, by, link) => `${by} has invited you to plan "${trip}" together.\n\nOpen this link to join:\n\n${link}\n\nIt works once and expires in seven days.`,
    html: (trip, by, link) => `<p>${by} has invited you to plan <b>${trip}</b> together.</p><p><a href="${link}">Open this link to join</a></p><p>It works once and expires in seven days.</p>`,
  },
  de: {
    subject: (trip, by) => `${by} lädt dich zu ${trip} ein`,
    text: (trip, by, link) => `${by} hat dich eingeladen, „${trip}“ gemeinsam zu planen.\n\nÖffne diesen Link, um dabei zu sein:\n\n${link}\n\nEr funktioniert einmal und läuft in sieben Tagen ab.`,
    html: (trip, by, link) => `<p>${by} hat dich eingeladen, <b>${trip}</b> gemeinsam zu planen.</p><p><a href="${link}">Öffne diesen Link, um dabei zu sein</a></p><p>Er funktioniert einmal und läuft in sieben Tagen ab.</p>`,
  },
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function listInvites(env, trip) {
  const { results } = await env.DB.prepare(
    `SELECT token_hash, email, role, member_id, name, invited_by, created_at, expires_at
       FROM invites WHERE trip_id = ?1 AND accepted_at IS NULL AND expires_at > ?2
      ORDER BY created_at DESC`
  ).bind(trip, Date.now()).all();
  return (results ?? []).map((r) => ({
    id: r.token_hash, email: r.email, role: r.role, memberId: r.member_id, name: r.name,
    invitedBy: r.invited_by, createdAt: r.created_at, expiresAt: r.expires_at,
  }));
}

/** @param ctx  { actor, tripName, cleanName, voterKey } from the Worker */
export async function handleInviteCreate(request, env, trip, ctx) {
  let body;
  try { body = await request.json(); } catch { return bad("Body must be JSON."); }
  const { error, name: by } = await ctx.actor(request, env, trip, "own");
  if (error) return error;

  const email = cleanEmail(body?.email);
  if (!email) return bad("That doesn't look like an email address.");
  const role = ROLES.includes(body?.role) ? body.role : "editor";
  const lang = body?.lang === "de" ? "de" : "en";
  const now = Date.now();

  let memberId = null, name = null;
  if (typeof body?.memberId === "string") {
    const m = await env.DB.prepare(
      "SELECT id, user_id FROM trip_members WHERE id = ?1 AND trip_id = ?2"
    ).bind(body.memberId, trip).first();
    if (!m) return bad("That name isn't on this trip.", 404);
    if (m.user_id) return bad("Someone has already claimed that name.", 409);
    memberId = m.id;
  } else if (body?.name != null && body.name !== "") {
    name = ctx.cleanName(body.name);
    if (!name) return bad("A name between 1 and 32 characters.");
    const taken = await env.DB.prepare(
      "SELECT user_id FROM trip_members WHERE trip_id = ?1 AND name_key = ?2"
    ).bind(trip, ctx.voterKey(name)).first();
    if (taken?.user_id) return bad("Someone has already claimed that name.", 409);
  }

  const already = await env.DB.prepare(
    `SELECT 1 FROM trip_members m JOIN users u ON u.id = m.user_id
      WHERE m.trip_id = ?1 AND u.email = ?2`
  ).bind(trip, email).first();
  if (already) return bad("That person is already on this trip.", 409);

  await env.DB.prepare("DELETE FROM invites WHERE expires_at < ?1").bind(now).run();
  const { count } = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM invites WHERE trip_id = ?1 AND accepted_at IS NULL AND expires_at > ?2"
  ).bind(trip, now).first();
  if (count >= 50) return bad("Fifty open invites is plenty. Let some expire first.");

  const token = randomToken();
  await env.DB.prepare(
    `INSERT INTO invites (token_hash, trip_id, email, role, member_id, name, invited_by, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  ).bind(await sha256(token), trip, email, role, memberId, name, by, now, now + INVITE_TTL).run();

  const link = `${new URL(request.url).origin}/invite?token=${token}`;
  const tripName = await ctx.tripName(env, trip);

  if (!env.RESEND_API_KEY)
    return json({ ok: true, sent: false, devLink: link, invites: await listInvites(env, trip) });
  try {
    const L = MAIL[lang];
    await sendMail(env, { to: email, subject: L.subject(tripName, by),
      text: L.text(tripName, by, link), html: L.html(esc(tripName), esc(by), link) });
  } catch (err) {
    console.error(err.message);
    await env.DB.prepare("DELETE FROM invites WHERE token_hash = ?1").bind(await sha256(token)).run();
    return bad("The invitation couldn't be sent. Try again in a moment.", 502);
  }
  return json({ ok: true, sent: true, invites: await listInvites(env, trip) });
}

export async function handleInviteList(request, env, trip, ctx) {
  const { error } = await ctx.actor(request, env, trip, "own");
  if (error) return error;
  return json({ invites: await listInvites(env, trip) });
}

export async function handleInviteRevoke(request, env, trip, ctx) {
  let body;
  try { body = await request.json(); } catch { return bad("Body must be JSON."); }
  const { error } = await ctx.actor(request, env, trip, "own");
  if (error) return error;
  if (typeof body?.id !== "string") return bad("Unknown invite.");
  await env.DB.prepare("DELETE FROM invites WHERE token_hash = ?1 AND trip_id = ?2")
    .bind(body.id, trip).run();
  return json({ ok: true, invites: await listInvites(env, trip) });
}

/** The link in the email. */
export async function handleInviteAccept(request, env, url, ctx) {
  const token = url.searchParams.get("token") || "";
  const now = Date.now();
  const fail = (why) => htmlPage("This invitation can't be used", why, "/", 400);

  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return fail("The link is incomplete. Copy the whole address from the email.");
  const hash = await sha256(token);
  const inv = await env.DB.prepare(
    `SELECT trip_id, email, role, member_id, name, expires_at, accepted_at FROM invites WHERE token_hash = ?1`
  ).bind(hash).first();
  if (!inv) return fail("It isn't one we sent, or it has been withdrawn.");
  if (inv.accepted_at) return fail("It has already been used. Sign in from the trip page instead.");
  if (inv.expires_at < now) return fail("It has expired — invitations last seven days. Ask for a new one.");

  const user = await findOrCreateUser(env, inv.email, now);
  const trip = inv.trip_id;

  const existing = await env.DB.prepare(
    "SELECT id FROM trip_members WHERE trip_id = ?1 AND user_id = ?2"
  ).bind(trip, user.id).first();

  if (!existing) {
    let member = inv.member_id
      ? await env.DB.prepare("SELECT id, user_id FROM trip_members WHERE id = ?1 AND trip_id = ?2")
          .bind(inv.member_id, trip).first()
      : null;
    if (member && member.user_id) member = null;   // claimed in the meantime; give them their own name

    if (!member && inv.name) {
      const byName = await env.DB.prepare(
        "SELECT id, user_id FROM trip_members WHERE trip_id = ?1 AND name_key = ?2"
      ).bind(trip, ctx.voterKey(inv.name)).first();
      if (byName && !byName.user_id) member = byName;
    }

    if (member) {
      await env.DB.prepare("UPDATE trip_members SET user_id = ?1, role = ?2 WHERE id = ?3")
        .bind(user.id, inv.role, member.id).run();
    } else {
      // A fresh name: the one on the invite, or the person's own, made unique if it clashes.
      const u = await env.DB.prepare("SELECT display_name FROM users WHERE id = ?1").bind(user.id).first();
      let name = inv.name || u.display_name;
      for (let i = 2; i < 50; i++) {
        const clash = await env.DB.prepare(
          "SELECT 1 FROM trip_members WHERE trip_id = ?1 AND name_key = ?2"
        ).bind(trip, ctx.voterKey(name)).first();
        if (!clash) break;
        name = `${inv.name || u.display_name} ${i}`;
      }
      await env.DB.prepare(
        `INSERT INTO trip_members (id, trip_id, name, name_key, note, added_by, created_at, user_id, role)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8)`
      ).bind(`m-${crypto.randomUUID()}`, trip, name, ctx.voterKey(name), "invite", now, user.id, inv.role).run();
    }
  }

  await env.DB.prepare("UPDATE invites SET accepted_at = ?1 WHERE token_hash = ?2").bind(now, hash).run();

  return new Response(null, {
    status: 302,
    headers: {
      location: `${url.origin}/t/${trip}/`,
      "set-cookie": await startSession(env, user.id, url, now),
      "cache-control": "no-store",
    },
  });
}
