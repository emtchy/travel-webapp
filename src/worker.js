import { parseMapLink, isShortMapLink, mapSearchTerm } from "./maplink.js";
import { json, bad } from "./http.js";
import { handleAuthRequest, handleAuthCallback, handleAuthMe, handleAuthLogout, handleAuthSettings, currentUser,
         handlePasswordSet, handlePasswordClear, handlePasswordLogin } from "./auth.js";
import { handleInviteCreate, handleInviteList, handleInviteRevoke, handleInviteAccept, listInvites, ROLES } from "./invites.js";
import { TEMPLATES, ITEM_COLUMNS as TEMPLATE_COLUMNS, templatesFor } from "./templates.js";
import { limited, ip, withHeaders } from "./limits.js";
import { getExpenses, balances, handleExpenseAdd, handleExpenseUpdate, handleExpenseRemove, CURRENCIES } from "./money.js";

/* ------------------------------------------------------------------ utils */

/**
 * Which trip a request is about, and the path with the trip taken out.
 *
 *   /api/t/7/plan/set   →  trip 7, path /api/plan/set
 *   /api/plan/set       →  trip 1, path /api/plan/set   (the old links)
 *
 * The un-prefixed paths stay as aliases for trip 1 for as long as the pages
 * use them (Phase 1 step 4 moves the pages). Anything else — a trip that is
 * not a number, or a number for a trip that does not exist — is a 404 that
 * says so, rather than an empty page that looks like a trip with nothing in it.
 */
function tripOf(url) {
  const m = url.pathname.match(/^\/api\/t\/([^/]+)(\/.*)?$/);
  if (!m) return { trip: 1, path: url.pathname };
  const trip = /^[1-9]\d{0,8}$/.test(m[1]) ? Number(m[1]) : null;
  return { trip, path: `/api${m[2] ?? ""}` };
}

/**
 * GET /api/t/<trip>/me — the account and, if it has one, its name on this trip.
 * The shell asks this on every page load; the answer decides whether the bar
 * shows a name, "Sign in", or "Who are you?".
 */
async function handleWhoAmI(request, env, trip) {
  const { user, member } = await whoIs(request, env, trip);
  // The trip's name comes along so the bar can show it even to someone who
  // is not on the trip and gets nothing else.
  const row = await env.DB.prepare("SELECT name, destination, visibility FROM trips WHERE id = ?1").bind(trip).first();
  return json({ user, member, trip: { id: trip, name: row?.name ?? null, destination: row?.destination ?? null,
                                      visibility: row?.visibility === "public" ? "public" : "private" } });
}

/**
 * POST /api/t/<trip>/leave — take yourself off a trip. Your votes, comments
 * and bookings stay under your name, as they do when the owner removes
 * someone; only the seat goes. The last owner cannot leave: hand the trip to
 * someone first.
 */
async function handleLeave(request, env, trip) {
  const { member, error } = await actor(request, env, trip);
  if (error) return error;
  if (member.role === "owner") {
    const { count } = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM trip_members WHERE trip_id = ?1 AND role = 'owner'"
    ).bind(trip).first();
    if (count <= 1) return bad("You're the only owner. Make someone else an owner first, or delete the trip.");
  }
  await env.DB.prepare("DELETE FROM trip_members WHERE id = ?1").bind(member.id).run();
  await env.DB.prepare("UPDATE users SET pinned_trip_id = NULL WHERE pinned_trip_id = ?1 AND id = ?2")
    .bind(trip, member.userId ?? "").run();
  return json({ ok: true });
}

/**
 * POST /api/t/<trip>/trip/delete  { confirm } — owner only, and `confirm` must
 * be the trip's name, typed. Everything under the trip goes: places, votes,
 * comments, bookings, plan, entries, journeys, members, invites, and any
 * pin pointing at it. There is no undo, which is why it asks for the name.
 */
async function handleTripDelete(request, env, trip) {
  let body;
  try { body = await request.json(); } catch { return bad("Body must be JSON."); }
  const { error } = await actor(request, env, trip, "own");
  if (error) return error;
  const info = await getTrip(env, trip);
  const typed = typeof body?.confirm === "string" ? body.confirm.trim() : "";
  if (!typed || typed.toLowerCase() !== String(info.name ?? "").trim().toLowerCase())
    return bad("Type the trip's name to confirm.");

  const gone = [
    "DELETE FROM votes WHERE trip_id = ?1", "DELETE FROM comments WHERE trip_id = ?1",
    "DELETE FROM booking_status WHERE trip_id = ?1", "DELETE FROM plan_entries WHERE trip_id = ?1",
    "DELETE FROM plan_notes WHERE trip_id = ?1", "DELETE FROM items WHERE trip_id = ?1",
    "DELETE FROM trip_travel WHERE trip_id = ?1", "DELETE FROM invites WHERE trip_id = ?1",
    "DELETE FROM expenses WHERE trip_id = ?1",
    "DELETE FROM trip_members WHERE trip_id = ?1",
    "UPDATE users SET pinned_trip_id = NULL WHERE pinned_trip_id = ?1",
    "DELETE FROM trips WHERE id = ?1",
  ];
  for (const sql of gone) await env.DB.prepare(sql).bind(trip).run();
  return json({ ok: true, deleted: trip });
}

/** POST /api/t/<trip>/member/role  { id, role } — owner only. */
async function handleMemberRole(request, env, trip) {
  let body;
  try { body = await request.json(); } catch { return bad("Body must be JSON."); }
  const { error } = await actor(request, env, trip, "own");
  if (error) return error;

  const { id, role } = body ?? {};
  if (typeof id !== "string") return bad("Unknown member.");
  if (!ROLES.includes(role)) return bad("Role must be owner, editor or viewer.");

  const target = await env.DB.prepare(
    "SELECT id, role FROM trip_members WHERE id = ?1 AND trip_id = ?2"
  ).bind(id, trip).first();
  if (!target) return bad("That person isn't on this trip.", 404);

  if (target.role === "owner" && role !== "owner") {
    const { count } = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM trip_members WHERE trip_id = ?1 AND role = 'owner'"
    ).bind(trip).first();
    if (count <= 1) return bad("A trip needs an owner. Make someone else an owner first.");
  }
  await env.DB.prepare("UPDATE trip_members SET role = ?1 WHERE id = ?2").bind(role, id).run();
  return json({ ok: true, ...(await snapshot(env, trip)) });
}

/**
 * GET /api/trips — the trips this account is on, with its name and role on
 * each. Signed-in only. `examples` will carry the public trips once they
 * exist (Phase 3 step 11); the page is already written to show them.
 */
async function handleTripList(request, env) {
  const user = await currentUser(request, env);
  if (!user) return bad("Sign in first.", 401);
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.name, t.destination, t.start_date, t.end_date, t.status, m.name AS member_name, m.role
       FROM trip_members m JOIN trips t ON t.id = m.trip_id
      WHERE m.user_id = ?1
      ORDER BY t.start_date DESC, t.id DESC`
  ).bind(user.id).all();
  const trips = (results ?? []).map((r) => ({
    id: r.id, name: r.name, destination: r.destination,
    startDate: r.start_date, endDate: r.end_date,
    memberName: r.member_name, role: r.role,
    days: daysBetween(r.start_date, r.end_date).length,
    status: r.status === "cancelled" ? "cancelled" : "planned",
    pinned: r.id === user.pinnedTripId,
  }));

  // The one trip that matters today, and what to say about it. "Today" is
  // the browser's date, sent along, because the server has no idea what
  // time zone the person is in.
  const today = new URL(request.url).searchParams.get("today");
  const featured = await featuredTrip(env, trips, isDate(today) ? today : new Date().toISOString().slice(0, 10));

  return json({ user, trips, featured, examples: await publicTrips(env) });
}

/**
 * Which trip comes first, and its summary. Pinned beats everything; else a
 * trip whose dates include today ("current"); else the nearest one still to
 * come ("next"). Cancelled trips and trips without dates are never featured.
 */
async function featuredTrip(env, trips, today) {
  const live = trips.filter((t) => t.status !== "cancelled");
  const pinned = live.find((t) => t.pinned);
  const current = live.find((t) => t.startDate && t.endDate && t.startDate <= today && today <= t.endDate);
  const next = live.filter((t) => t.startDate && t.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  const trip = pinned ?? current ?? next;
  if (!trip) return null;

  const phase = trip.startDate && trip.endDate && trip.startDate <= today && today <= trip.endDate ? "current"
    : trip.startDate && trip.startDate > today ? "next"
    : trip.endDate && trip.endDate < today ? "past" : "undated";
  const out = { id: trip.id, phase, pinned: !!pinned };

  if (phase === "current") {
    const days = daysBetween(trip.startDate, trip.endDate);
    out.dayIndex = days.indexOf(today) + 1;
    out.totalDays = days.length;
    out.today = today;
    out.stops = await stopsOn(env, trip.id, today);
  } else if (phase === "next") {
    out.daysUntil = Math.round((Date.parse(trip.startDate) - Date.parse(today)) / 864e5);
    Object.assign(out, await stillToDo(env, trip.id, trip.role));
  }
  return out;
}

/** The plan for one day, as the Plan page would show it, with places to route to. */
async function stopsOn(env, trip, day) {
  const [entries, bookings, notes, custom, sights] = await Promise.all([
    getPlanEntries(env, trip), getBookingStatus(env, trip), getPlanNotes(env, trip),
    getCustom(env, trip), getSights(env, trip),
  ]);
  const byId = new Map([...sights, ...custom].map((s) => [s.id, s]));
  const stops = [];
  for (const b of bookings) if (b.status === "booked" && b.date === day && byId.has(b.id))
    stops.push({ id: b.id, label: byId.get(b.id).name, start: b.time, end: b.endTime, source: "booked",
                 lat: byId.get(b.id).lat ?? null, lon: byId.get(b.id).lon ?? null });
  for (const e of entries) if (e.day === day && byId.has(e.id))
    stops.push({ id: e.id, label: byId.get(e.id).name, start: e.start, end: e.end, source: "hand",
                 lat: byId.get(e.id).lat ?? null, lon: byId.get(e.id).lon ?? null });
  for (const n of notes) if (n.day === day)
    stops.push({ id: n.id, label: n.label, start: n.start, end: n.end, source: "own", lat: n.lat, lon: n.lon });
  return stops.sort((a, b) => (a.start ?? "99:99").localeCompare(b.start ?? "99:99"));
}

/** What a trip still needs before it starts. */
async function stillToDo(env, trip, role) {
  const [bookings, entries, votes, custom, sights] = await Promise.all([
    getBookingStatus(env, trip), getPlanEntries(env, trip), getVotes(env, trip),
    getCustom(env, trip), getSights(env, trip),
  ]);
  const state = new Map(bookings.map((b) => [b.id, b]));
  const placed = new Set([...entries.map((e) => e.id), ...bookings.filter((b) => b.status === "booked" && b.date).map((b) => b.id)]);
  const all = [...sights, ...custom];
  const bookable = (s) => (s.custom ? !!s.costs : s.cost !== "free") || !!s.bookingRequired;
  const toBook = all.filter((s) => bookable(s) && !state.has(s.id)).length;
  const unplaced = all.filter((s) => (votes[s.id]?.length ?? 0) > 0 && !placed.has(s.id)).length;
  const out = { toBook, unplaced, places: all.length };
  if (role === "owner") out.invitesOpen = (await listInvites(env, trip)).length;
  return out;
}

/**
 * POST /api/auth/delete  { confirm } — your account, gone. `confirm` must be
 * your address, typed. Refused while you are the only owner of any trip:
 * hand it over or delete it first, so no trip is left with nobody running
 * it. Leaves each trip the way leave() does — what you did stays under your
 * name — then removes sessions, open sign-in links and invitations to your
 * address, and the account itself. The cookie is cleared in the answer.
 */
async function handleAccountDelete(request, env, url) {
  let body;
  try { body = await request.json(); } catch { return bad("Body must be JSON."); }
  const user = await currentUser(request, env);
  if (!user) return bad("Sign in first.", 401);
  const typed = typeof body?.confirm === "string" ? body.confirm.trim().toLowerCase() : "";
  if (typed !== user.email) return bad("Type your email address to confirm.");

  const { results } = await env.DB.prepare(
    `SELECT t.name FROM trip_members m JOIN trips t ON t.id = m.trip_id
      WHERE m.user_id = ?1 AND m.role = 'owner'
        AND (SELECT COUNT(*) FROM trip_members o WHERE o.trip_id = m.trip_id AND o.role = 'owner') = 1`
  ).bind(user.id).all();
  const alone = (results ?? []).map((r) => r.name);
  if (alone.length)
    return bad(`You're the only owner of ${alone.map((n) => `"${n}"`).join(", ")}. Make someone else an owner, or delete it, first.`, 409);

  for (const sql of [
    "DELETE FROM trip_members WHERE user_id = ?1",
    "DELETE FROM sessions WHERE user_id = ?1",
    "DELETE FROM users WHERE id = ?1",
  ]) await env.DB.prepare(sql).bind(user.id).run();
  for (const sql of [
    "DELETE FROM login_tokens WHERE email = ?1",
    "DELETE FROM invites WHERE email = ?1 AND accepted_at IS NULL",
  ]) await env.DB.prepare(sql).bind(user.email).run();

  return new Response(JSON.stringify({ ok: true, deleted: true }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
      "set-cookie": `trip_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${url.protocol === "https:" ? "; Secure" : ""}` },
  });
}

/** POST /api/auth/pin  { tripId | null } — the trip to show first, or none. */
async function handlePin(request, env) {
  let body;
  try { body = await request.json(); } catch { return bad("Body must be JSON."); }
  const user = await currentUser(request, env);
  if (!user) return bad("Sign in first.", 401);
  const { tripId } = body ?? {};
  if (tripId !== null && !(Number.isInteger(tripId) && tripId > 0)) return bad("tripId must be a number or null.");
  if (tripId !== null) {
    const on = await env.DB.prepare("SELECT 1 FROM trip_members WHERE trip_id = ?1 AND user_id = ?2").bind(tripId, user.id).first();
    if (!on) return bad("You're not on that trip.", 403);
  }
  await env.DB.prepare("UPDATE users SET pinned_trip_id = ?1 WHERE id = ?2").bind(tripId, user.id).run();
  return json({ ok: true, pinnedTripId: tripId });
}

/**
 * POST /api/trips  { name, destination?, startDate?, endDate?, template? }
 *
 * Makes the trip and puts the signed-in account on it as its owner, under
 * the account's display name. A template copies a ready-made list of places
 * in as the trip's own rows. Answers with the new trip's id; the page goes
 * to its Details.
 */
async function handleTripCreate(request, env) {
  let body;
  try { body = await request.json(); } catch { return bad("Body must be JSON."); }
  const user = await currentUser(request, env);
  if (!user) return bad("Sign in first.", 401);

  const name = cleanText(body?.name, 80);
  if (name === undefined) return bad("Keep the trip name under 80 characters.");
  if (!name) return bad("Give the trip a name.");
  const destination = cleanText(body?.destination, 80);
  if (destination === undefined) return bad("Keep the destination under 80 characters.");

  const { startDate, endDate } = body ?? {};
  for (const [label, v] of [["first", startDate], ["last", endDate]])
    if (v != null && v !== "" && !isDate(v)) return bad(`The ${label} day should look like 2027-03-13.`);
  const start = startDate || null, end = endDate || null;
  if ((start && !end) || (!start && end)) return bad("Give both a first and a last day, or neither.");
  if (start && end && end < start) return bad("The trip can't end before it starts.");
  if (start && end && daysBetween(start, end).length > 60)
    return bad("That's more than sixty days. Split it into separate trips.");

  const template = body?.template ? TEMPLATES.find((t) => t.key === body.template) : null;
  if (body?.template && !template) return bad("Unknown template.");

  const { count } = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM trip_members WHERE user_id = ?1 AND role = 'owner'"
  ).bind(user.id).first();
  if (count >= 30) return bad("Thirty trips of your own is plenty. Delete one first.");
  const { recent } = await env.DB.prepare(
    `SELECT COUNT(*) AS recent FROM trips t JOIN trip_members m ON m.trip_id = t.id
      WHERE m.user_id = ?1 AND m.role = 'owner' AND t.created_at > ?2`
  ).bind(user.id, Date.now() - 60 * 60 * 1000).first();
  if (recent >= 5) return bad("That's five trips in an hour. Take a break and try again later.", 429);

  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO trips (name, destination, start_date, end_date, set_by, updated_at, created_at, visibility)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'private') RETURNING id`
  ).bind(name, destination, start, end, user.displayName, now, now).first();
  const id = row.id;

  const memberName = cleanName(user.displayName) || "Owner";
  await env.DB.prepare(
    `INSERT INTO trip_members (id, trip_id, name, name_key, note, added_by, created_at, user_id, role)
     VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, 'owner')`
  ).bind(`m-${crypto.randomUUID()}`, id, memberName, voterKey(memberName), memberName, now, user.id).run();

  if (template) {
    const marks = TEMPLATE_COLUMNS.map((_, i) => `?${i + 1}`).join(", ");
    const sql = `INSERT INTO items (${TEMPLATE_COLUMNS.join(", ")}) VALUES (${marks})`;
    const stmts = template.rows(id, now).map((r) => env.DB.prepare(sql).bind(...r));
    if (typeof env.DB.batch === "function") await env.DB.batch(stmts);
    else for (const st of stmts) await st.run();
  }

  return json({ ok: true, id, trip: await getTrip(env, id) });
}

/** The public trips, for the front page. */
async function publicTrips(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, destination, start_date, end_date FROM trips
      WHERE visibility = 'public' ORDER BY id ASC LIMIT 12`
  ).all();
  return (results ?? []).map((r) => ({
    id: r.id, name: r.name, destination: r.destination, startDate: r.start_date, endDate: r.end_date,
    days: daysBetween(r.start_date, r.end_date).length,
  }));
}

/* ------------------------------------------------------------------ pages */

/** The four pages, by the path they have inside a trip. */
const PAGES = {
  "/": "/index.html",
  "/plan": "/plan.html",
  "/bookings": "/bookings.html",
  "/money": "/money.html",
  "/details": "/details.html",
};

const NOT_FOUND_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>No such trip</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
background:#F5F5F7;color:#1D1D1F;display:grid;place-items:center;min-height:100dvh;margin:0}
main{text-align:center;padding:24px}h1{font-size:22px;margin:0 0 8px}p{color:#5C5C63;margin:0}</style>
<main><h1>No such trip</h1><p>There is nothing at this address. Check the link you were sent.</p></main>`;

/**
 * Pages live under a trip: /t/<id>/, /t/<id>/plan, /t/<id>/bookings,
 * /t/<id>/details. The page files themselves are the same four HTML files
 * whatever the trip — the shell reads the trip out of the address and the
 * API answers for that trip — so serving a page is a matter of handing the
 * assets binding the right file.
 *
 * The old addresses (/, /plan, …) redirect to trip 1: they are the links the
 * London group has, and a link that stops working is worse than a redirect.
 * Everything else — stylesheets, scripts, photos — is served as it is.
 */
async function servePage(request, env, url) {
  const path = url.pathname;
  const asset = (file) => env.ASSETS.fetch(new Request(new URL(file, url), request));

  const m = path.match(/^\/t\/([^/]+)(\/.*)?$/);
  if (m) {
    const trip = /^[1-9]\d{0,8}$/.test(m[1]) ? Number(m[1]) : null;
    const sub = (m[2] ?? "").replace(/\/+$/, "") || "/";
    if (m[2] == null) return Response.redirect(`${url.origin}/t/${m[1]}/${url.search}`, 302);
    if (!(trip && await tripExists(env, trip)) || !PAGES[sub])
      return new Response(NOT_FOUND_PAGE, { status: 404,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    return asset(PAGES[sub]);
  }

  // The front page and the privacy note. The other old page paths still
  // redirect to trip 1, so the links the London group has keep working.
  if (path === "/") return asset("/home.html");
  if (path === "/privacy" || path === "/privacy/") return asset("/privacy.html");
  if (PAGES[path] && path !== "/money") return Response.redirect(`${url.origin}/t/1${path}${url.search}`, 302);
  return env.ASSETS.fetch(request);
}

async function tripExists(env, trip) {
  if (trip == null) return false;
  const row = await env.DB.prepare("SELECT 1 FROM trips WHERE id = ?1").bind(trip).first();
  return !!row;
}

/**
 * What the trip is, read from the database rather than written here.
 *
 * This used to be a constant, which is exactly why there could only ever be
 * one trip. Everything downstream — which dates are valid, where address
 * lookups look — now follows whatever the Trip page says.
 */
const FALLBACK_TRIP = { name: "Trip", destination: "", startDate: null, endDate: null };

/** Every date from start to end, inclusive. Empty if the dates aren't set. */
function daysBetween(start, end) {
  if (!isDate(start) || !isDate(end)) return [];
  const out = [];
  const at = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (last < at) return [];
  // A trip longer than this is not a trip, and an unbounded loop is a bug.
  for (let i = 0; i < 400 && at <= last; i++) {
    out.push(at.toISOString().slice(0, 10));
    at.setUTCDate(at.getUTCDate() + 1);
  }
  return out;
}

const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

async function getTrip(env, trip) {
  const row = await env.DB.prepare(
    `SELECT name, destination, start_date, end_date,
            base_name, base_lat, base_lon, base_checkin, base_checkout,
            base_ref, base_phone, near_lat, near_lon, notes, set_by, visibility, status, currency
       FROM trips WHERE id = ?1`
  ).bind(trip).first();

  const days = daysBetween(row?.start_date, row?.end_date);

  return {
    id: trip,
    visibility: row?.visibility === "public" ? "public" : "private",
    status: row?.status === "cancelled" ? "cancelled" : "planned",
    currency: row?.currency || "EUR",
    name: row?.name ?? FALLBACK_TRIP.name,
    destination: row?.destination ?? FALLBACK_TRIP.destination,
    startDate: row?.start_date ?? null,
    endDate: row?.end_date ?? null,
    days,
    notes: row?.notes ?? null,
    // One set_by column covers the whole record, so it belongs here rather
    // than pretending to describe only the hotel.
    setBy: row?.set_by ?? null,
    // Where address lookups are biased: the hotel once it is set, else what
    // the trip itself says, else nowhere — a new trip has no reason to look
    // for its places in London.
    near: (row?.near_lat ?? row?.base_lat) != null
      ? { lat: row.near_lat ?? row.base_lat, lon: row.near_lon ?? row.base_lon }
      : null,
    base: row?.base_lat != null && row?.base_lon != null
      ? { name: row.base_name, lat: row.base_lat, lon: row.base_lon,
          checkIn: row.base_checkin, checkOut: row.base_checkout,
          reference: row.base_ref, phone: row.base_phone }
      : null,
  };
}

const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** null for absent, undefined for malformed — same shape as cleanText. */
function cleanClock(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string" || !isTime(raw.trim())) return undefined;
  return raw.trim();
}

/** Display name -> stable key. "Anna" and " anna " are the same person. */
const voterKey = (name) => name.trim().toLowerCase().replace(/\s+/g, " ");

function cleanName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 32) return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

function cleanText(raw, max) {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return undefined; // undefined => invalid
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (text.length > max) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(text)) return undefined;
  return text;
}

/** Only http(s). Anything else (javascript:, data:) is rejected outright. */
function cleanUrl(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text) return null;
  if (text.length > 500) return undefined;
  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  return parsed.href;
}

/* ------------------------------------------------------------ identity */

/**
 * Who is making this request, on this trip.
 *
 * `user` is the signed-in account, or null. `member` is the name that account
 * has claimed on this trip — the row every vote, comment and booking is keyed
 * on — or null if it has not claimed one yet. Every write is made as the
 * member; the body's `voter`, which the pages still send out of habit, is
 * ignored. That is the whole point of accounts: the server decides who you
 * are, not the request.
 */
async function whoIs(request, env, trip) {
  const user = await currentUser(request, env);
  if (!user) return { user: null, member: null };
  const m = await env.DB.prepare(
    "SELECT id, name, name_key, role FROM trip_members WHERE trip_id = ?1 AND user_id = ?2"
  ).bind(trip, user.id).first();
  return { user, member: m ? { id: m.id, name: m.name, key: m.name_key, role: m.role, userId: user.id } : null };
}

/**
 * What each role may do. A role includes everything below it.
 *   view   read the trip, vote, comment            — viewer, editor, owner
 *   edit   places, bookings, the plan, addresses    — editor, owner
 *   own    the trip itself, its people, invites     — owner
 */
const RANK = { viewer: 0, editor: 1, owner: 2 };
const NEED = { view: 0, edit: 1, own: 2 };
const NOT_ALLOWED = {
  edit: "Only editors and owners can change that. Ask the trip's owner.",
  own: "Only the trip's owner can do that.",
};

/**
 * A reader: a member, or anyone at all on a public trip. For reads only —
 * writes always go through actor(), so a public trip is looked at, never
 * changed, by people who are not on it.
 */
async function reader(request, env, trip) {
  const got = await actor(request, env, trip);
  if (!got.error) return got;
  const row = await env.DB.prepare("SELECT visibility FROM trips WHERE id = ?1").bind(trip).first();
  if (row?.visibility === "public") return { user: null, member: null, name: null, readOnly: true };
  return got;
}

/** The member acting, or the response to send back instead. */
async function actor(request, env, trip, need = "view") {
  const { user, member } = await whoIs(request, env, trip);
  if (!user) return { error: bad("Sign in first.", 401) };
  if (!member) return { error: bad("You're not on this trip. Ask whoever runs it for an invitation.", 403) };
  if ((RANK[member.role] ?? 0) < NEED[need]) return { error: bad(NOT_ALLOWED[need], 403) };
  return { user, member, name: member.name };
}

/* --------------------------------------------------------------- database */

async function getVotes(env, trip) {
  const { results } = await env.DB.prepare(
    "SELECT sight_id, voter_name FROM votes WHERE trip_id = ?1 ORDER BY created_at ASC"
  ).bind(trip).all();

  const byId = {};
  for (const row of results ?? []) (byId[row.sight_id] ||= []).push(row.voter_name);
  return byId;
}

/* ---- places ----
 * One table, two shapes on the wire. A built-in place carries the fields the
 * London template had (rank, German text, opening days); an added one carries
 * who added it and whether it costs anything. The pages tell them apart by
 * `custom`, as they always did, so the API's shape did not change when the
 * storage did.
 */

const parseList = (text) => {
  try { const v = JSON.parse(text ?? "[]"); return Array.isArray(v) ? v : []; }
  catch { return []; }
};

const ITEM_COLUMNS = `id, source, rank, tier, name, name_de, summary, summary_de,
  categories, area, station, cost, price_label, price_label_de, open_on,
  booking_required, flags, url, wiki, address, lat, lon, added_by, created_at`;

function builtinOf(row) {
  return {
    id: row.id,
    rank: row.rank,
    tier: row.tier,
    name: row.name,
    categories: parseList(row.categories),
    summary: row.summary,
    area: row.area,
    station: row.station,
    cost: row.cost,
    priceLabel: row.price_label,
    openOn: parseList(row.open_on),
    bookingRequired: !!row.booking_required,
    flags: parseList(row.flags),
    url: row.url,
    wiki: row.wiki,
    name_de: row.name_de,
    summary_de: row.summary_de,
    priceLabel_de: row.price_label_de,
    lat: row.lat,
    lon: row.lon,
  };
}

function addedOf(row) {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    url: row.url,
    addedBy: row.added_by,
    createdAt: row.created_at,
    costs: row.cost !== "free",
    priceLabel: row.price_label,
    bookingRequired: !!row.booking_required,
    address: row.address,
    lat: row.lat,
    lon: row.lon,
    custom: true,
  };
}

/** The trip's built-in places, in list order. */
async function getSights(env, trip) {
  const { results } = await env.DB.prepare(
    `SELECT ${ITEM_COLUMNS} FROM items
      WHERE trip_id = ?1 AND source = 'builtin' ORDER BY rank ASC, name ASC`
  ).bind(trip).all();
  return (results ?? []).map(builtinOf);
}

/** The places people added, oldest first. */
async function getCustom(env, trip) {
  const { results } = await env.DB.prepare(
    `SELECT ${ITEM_COLUMNS} FROM items
      WHERE trip_id = ?1 AND source = 'added' ORDER BY created_at ASC`
  ).bind(trip).all();
  return (results ?? []).map(addedOf);
}

/**
 * Booked, or decided against. Anything not listed here is still to be sorted
 * out, which is the common case and costs no storage.
 */
async function getBookingStatus(env, trip) {
  const { results } = await env.DB.prepare(
    `SELECT sight_id, status, marked_by, booked_date, booked_time, booked_end,
            created_at
       FROM booking_status WHERE trip_id = ?1 ORDER BY created_at ASC`
  ).bind(trip).all();
  return (results ?? []).map((r) => ({
    id: r.sight_id,
    status: r.status,
    by: r.marked_by,
    date: r.booked_date,
    time: r.booked_time,
    endTime: r.booked_end,
    at: r.created_at,
  }));
}

async function isKnownSight(env, id, trip) {
  const row = await env.DB.prepare("SELECT 1 FROM items WHERE id = ?1 AND trip_id = ?2")
    .bind(id, trip)
    .first();
  return !!row;
}

async function getComments(env, trip) {
  const { results } = await env.DB.prepare(
    `SELECT id, sight_id, author, body, created_at
       FROM comments WHERE trip_id = ?1 ORDER BY created_at ASC`
  ).bind(trip).all();

  const bySight = {};
  for (const row of results ?? []) {
    (bySight[row.sight_id] ||= []).push({
      id: row.id,
      author: row.author,
      body: row.body,
      createdAt: row.created_at,
    });
  }
  return bySight;
}

/** Everything the page needs, so a mutation never needs a follow-up GET. */
const snapshot = async (env, trip) => ({
  custom: await getCustom(env, trip),
  votes: await getVotes(env, trip),
  comments: await getComments(env, trip),
  bookings: await getBookingStatus(env, trip),
  plan: await getPlanEntries(env, trip),
  notes: await getPlanNotes(env, trip),
  trip: await getTrip(env, trip),
  members: await getMembers(env, trip),
  travel: await getTravel(env, trip),
  expenses: await getExpenses(env, trip),
});

/* ------------------------------------------------------------- handlers */

async function handleVote(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const { sightId, wanted } = body ?? {};
  const { name: name, error: authError } = await actor(request, env, trip);
  if (authError) return authError;
  if (typeof sightId !== "string" || !(await isKnownSight(env, sightId, trip)))
    return bad("Unknown sight.");
  if (typeof wanted !== "boolean") return bad("`wanted` must be true or false.");

  if (wanted) {
    await env.DB.prepare(
      `INSERT INTO votes (sight_id, voter_key, voter_name, created_at, trip_id)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (sight_id, voter_key)
       DO UPDATE SET voter_name = excluded.voter_name`
    )
      .bind(sightId, voterKey(name), name, Date.now(), trip)
      .run();
  } else {
    await env.DB.prepare(
      "DELETE FROM votes WHERE sight_id = ?1 AND voter_key = ?2"
    )
      .bind(sightId, voterKey(name))
      .run();
  }

  return json({ ok: true, ...(await snapshot(env, trip)) });
}

async function handleAddSight(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const { name: addedBy, error: authError } = await actor(request, env, trip, "edit");

  if (authError) return authError;

  const name = cleanText(body?.name, 80);
  if (name === undefined) return bad("That name is too long or has odd characters.");
  if (!name) return bad("A name is required (up to 80 characters).");

  const summary = cleanText(body?.summary, 300);
  if (summary === undefined) return bad("Keep the description under 300 characters.");

  const url = cleanUrl(body?.url);
  if (url === undefined) return bad("That link doesn't look like a web address.");

  const costs = body?.costs === true;
  const bookingRequired = body?.bookingRequired === true;

  const priceLabel = cleanText(body?.priceLabel, 40);
  if (priceLabel === undefined) return bad("Keep the price under 40 characters.");

  const { count } = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM items WHERE trip_id = ?1 AND source = 'added'"
  ).bind(trip).first();
  if (count >= 100) return bad("That's 100 added sights — plenty. Remove some first.");

  const duplicate = await env.DB.prepare(
    "SELECT 1 FROM items WHERE lower(name) = lower(?1) AND trip_id = ?2"
  )
    .bind(name, trip)
    .first();
  if (duplicate) return bad("Someone already added that one.");

  const id = `custom-${crypto.randomUUID()}`;

  await env.DB.prepare(
    `INSERT INTO items (id, source, name, summary, url, added_by, added_by_key,
                        created_at, cost, price_label, booking_required, trip_id)
     VALUES (?1, 'added', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
  )
    .bind(id, name, summary, url, addedBy, voterKey(addedBy), Date.now(),
          costs ? "paid" : "free", priceLabel, bookingRequired ? 1 : 0, trip)
    .run();

  // Adding something counts as wanting it.
  await env.DB.prepare(
    `INSERT INTO votes (sight_id, voter_key, voter_name, created_at, trip_id)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  )
    .bind(id, voterKey(addedBy), addedBy, Date.now(), trip)
    .run();

  return json({ ok: true, id, ...(await snapshot(env, trip)) });
}

/**
 * Change whether an added sight costs anything or needs booking.
 *
 * Anyone can set these, unlike removal which stays with whoever added it. They
 * are facts about the place rather than something owned — and the person who
 * knows a tour has to be booked is often not the person who added it.
 */
async function handleEditSight(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const { name: name, error: authError } = await actor(request, env, trip, "edit");

  if (authError) return authError;

  const { id, costs, bookingRequired } = body ?? {};
  if (typeof id !== "string" || !id.startsWith("custom-"))
    return bad("Only added sights can be edited here.");
  if (typeof costs !== "boolean") return bad("`costs` must be true or false.");
  if (typeof bookingRequired !== "boolean")
    return bad("`bookingRequired` must be true or false.");

  const row = await env.DB.prepare(
    "SELECT 1 FROM items WHERE id = ?1 AND trip_id = ?2 AND source = 'added'"
  ).bind(id, trip).first();
  if (!row) return bad("That sight is already gone.", 404);

  const priceLabel = cleanText(body?.priceLabel, 40);
  if (priceLabel === undefined) return bad("Keep the price under 40 characters.");

  await env.DB.prepare(
    `UPDATE items
        SET cost = ?1, price_label = ?2, booking_required = ?3
      WHERE id = ?4 AND trip_id = ?5`
  )
    .bind(costs ? "paid" : "free", costs ? priceLabel : null, bookingRequired ? 1 : 0, id, trip)
    .run();

  return json({ ok: true, ...(await snapshot(env, trip)) });
}

/**
 * Turn what someone typed into coordinates.
 *
 * Accepts a place name, an address, a pasted Google or Apple Maps link, or raw
 * coordinates — because for a walking tour with a meeting point, the link is
 * often the only thing anyone has. Parsing links is offline; only a shortened
 * share link needs the redirect followed.
 *
 * OpenStreetMap's Nominatim does the searching: no key, and its policy asks for
 * an identifying User-Agent and about one call a second, which is fine for a
 * group filling in a handful. A public version would need a cache and a limit.
 */
async function handleGeocode(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }
  { const { error } = await actor(request, env, trip, "edit"); if (error) return error; }

  const q = cleanText(body?.q, 500);
  if (q === undefined) return bad("That's too long to look up.");
  if (!q) return bad("Type an address, or paste a maps link.");

  const pasted = parseMapLink(q);
  if (pasted)
    return json({ ok: true, results: [{ label: `${pasted.lat}, ${pasted.lon}`,
      lat: pasted.lat, lon: pasted.lon, from: pasted.source }] });

  if (isShortMapLink(q)) {
    let resolved = null;
    try {
      const res = await fetch(q, { redirect: "follow",
        headers: { "user-agent": "travel-webapp/1.0 (group trip planner)" } });
      resolved = parseMapLink(res.url);
    } catch { /* fall through */ }

    if (resolved)
      return json({ ok: true, results: [{ label: `${resolved.lat}, ${resolved.lon}`,
        lat: resolved.lat, lon: resolved.lon, from: resolved.source }] });

    return bad("That short link couldn't be opened. Open it in Maps and copy the " +
               "full address bar URL, or paste coordinates like \"51.5074, -0.1278\".");
  }

  // A maps link with a name but no coordinates: search for the name, not the URL.
  const term = mapSearchTerm(q) ?? q;
  const near = (await getTrip(env, trip)).near;
  const d = 0.6; // roughly 60 km, wide enough for a day trip out of town

  // The same address asked twice — by two people, or on two days — costs
  // one call. Keyed by the query and the bias it was asked with, kept a month.
  const cacheKey = `${term.trim().toLowerCase()}|${near ? `${near.lat.toFixed(1)},${near.lon.toFixed(1)}` : "-"}`;
  const cached = await env.DB.prepare(
    "SELECT results FROM geocode_cache WHERE key = ?1 AND created_at > ?2"
  ).bind(cacheKey, Date.now() - 30 * 864e5).first();
  if (cached) return json({ ok: true, results: JSON.parse(cached.results), cached: true });

  let results;
  try {
    const res = await fetch(
      "https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=0" +
      (near ? `&viewbox=${near.lon - d},${near.lat + d},${near.lon + d},${near.lat - d}` : "") +
      `&q=${encodeURIComponent(term)}`,
      { headers: { "user-agent": "travel-webapp/1.0 (group trip planner)" } });
    if (!res.ok) return bad(`The lookup service answered ${res.status}. Try again shortly.`, 502);
    results = await res.json();
  } catch {
    return bad("Couldn't reach the lookup service. Try again shortly.", 502);
  }

  const hits = (Array.isArray(results) ? results : []).slice(0, 5)
    .map((r) => ({ label: r.display_name,
                   lat: Math.round(Number(r.lat) * 10000) / 10000,
                   lon: Math.round(Number(r.lon) * 10000) / 10000 }));
  await env.DB.prepare(
    `INSERT INTO geocode_cache (key, results, created_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (key) DO UPDATE SET results = excluded.results, created_at = excluded.created_at`
  ).bind(cacheKey, JSON.stringify(hits), Date.now()).run();
  return json({ ok: true, results: hits });
}

/**
 * GET /api/t/<trip>/photos — a picture per place, { id: url }.
 *
 * Wikipedia's lead image for every place that names its article. Kept in
 * photo_cache: a hit is served for a year, a miss remembered for a week so
 * a place with no picture is not asked about on every page view. Gaps are
 * filled here, on the server, in batches of fifty — which is one call for a
 * whole trip instead of one per visitor. The browser never talks to
 * Wikipedia any more, so the content-security policy does not have to allow it.
 */
async function handlePhotos(request, env, trip) {
  const { error } = await reader(request, env, trip);
  if (error) return error;
  const sights = await getSights(env, trip);
  const titles = [...new Set(sights.map((s) => s.wiki).filter(Boolean))];
  if (!titles.length) return json({ photos: {} });

  const now = Date.now();
  const urls = new Map();
  const missing = [];
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const { results } = await env.DB.prepare(
      `SELECT wiki, url, created_at FROM photo_cache WHERE wiki IN (${batch.map((_, j) => `?${j + 1}`).join(", ")})`
    ).bind(...batch).all();
    const seen = new Map((results ?? []).map((r) => [r.wiki, r]));
    for (const t of batch) {
      const r = seen.get(t);
      const fresh = r && (r.url ? r.created_at > now - 365 * 864e5 : r.created_at > now - 7 * 864e5);
      if (fresh) { if (r.url) urls.set(t, r.url); } else missing.push(t);
    }
  }

  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    const found = await wikipediaThumbnails(batch);
    for (const t of batch) {
      if (found.has(t)) urls.set(t, found.get(t));
      await env.DB.prepare(
        `INSERT INTO photo_cache (wiki, url, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (wiki) DO UPDATE SET url = excluded.url, created_at = excluded.created_at`
      ).bind(t, found.get(t) ?? null, now).run();
    }
  }

  const photos = {};
  for (const s of sights) if (s.wiki && urls.has(s.wiki)) photos[s.id] = urls.get(s.wiki);
  return json({ photos });
}

/** Lead-image thumbnails for a batch of article titles. Titles that failed are simply absent. */
async function wikipediaThumbnails(titles) {
  const out = new Map();
  if (!titles.length) return out;
  try {
    const res = await fetch(
      "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2" +
      "&prop=pageimages&piprop=thumbnail&pithumbsize=640&redirects=1" +
      `&pilimit=${titles.length}&titles=${encodeURIComponent(titles.join("|"))}`,
      { headers: { "user-agent": "travel-webapp/1.0 (group trip planner)" } });
    if (!res.ok) return out;
    const data = await res.json();
    const byTitle = new Map();
    for (const page of data?.query?.pages ?? []) if (page.thumbnail?.source) byTitle.set(page.title, page.thumbnail.source);
    for (const r of data?.query?.redirects ?? []) if (byTitle.has(r.to)) byTitle.set(r.from, byTitle.get(r.to));
    for (const n of data?.query?.normalized ?? []) if (byTitle.has(n.to)) byTitle.set(n.from, byTitle.get(n.to));
    for (const t of titles) if (byTitle.has(t)) out.set(t, byTitle.get(t));
  } catch { /* a missing photo is a placeholder, not an error */ }
  return out;
}

/**
 * Give a location to an added sight or to one of your own plan entries, or
 * take it away again. The rules are the same for both, so is the handler —
 * only the table and the id prefix differ.
 */
function makeAddressHandler({ table, prefix, missing, wrongKind }) {
  return async function handleAddress(request, env, trip) {
    let body;
    try {
      body = await request.json();
    } catch {
      return bad("Body must be JSON.");
    }

    const { name: name, error: authError } = await actor(request, env, trip, "edit");

    if (authError) return authError;

    const { id, lat, lon } = body ?? {};
    if (typeof id !== "string" || !id.startsWith(prefix)) return bad(wrongKind);

    const row = await env.DB.prepare(`SELECT 1 FROM ${table} WHERE id = ?1 AND trip_id = ?2`)
      .bind(id, trip).first();
    if (!row) return bad(missing, 404);

    const address = cleanText(body?.address, 200);
    if (address === undefined) return bad("That address is too long.");

    // Both or neither: half a coordinate is worse than none, because the route
    // would silently place the stop on the equator and still look valid.
    const clearing = lat == null && lon == null;
    if (!clearing) {
      if (typeof lat !== "number" || typeof lon !== "number" ||
          !Number.isFinite(lat) || !Number.isFinite(lon) ||
          lat < -90 || lat > 90 || lon < -180 || lon > 180)
        return bad("Those coordinates don't look right.");
    }

    await env.DB.prepare(
      `UPDATE ${table} SET address = ?1, lat = ?2, lon = ?3 WHERE id = ?4 AND trip_id = ?5`
    )
      .bind(clearing ? null : address, clearing ? null : lat, clearing ? null : lon, id, trip)
      .run();

    return json({ ok: true, ...(await snapshot(env, trip)) });
  };
}

const handleSightAddress = makeAddressHandler({
  table: "items", prefix: "custom-",
  missing: "That sight is already gone.",
  wrongKind: "Only added sights need an address filling in.",
});

const handleNoteAddress = makeAddressHandler({
  table: "plan_notes", prefix: "note-",
  missing: "That entry is already gone.",
  wrongKind: "That isn't one of your own entries.",
});

async function handleDeleteSight(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const { name: name, error: authError } = await actor(request, env, trip, "edit");

  if (authError) return authError;
  const { id } = body ?? {};
  if (typeof id !== "string" || !id.startsWith("custom-"))
    return bad("Only added sights can be removed.");

  const row = await env.DB.prepare(
    "SELECT added_by_key FROM items WHERE id = ?1 AND trip_id = ?2 AND source = 'added'"
  )
    .bind(id, trip)
    .first();
  if (!row) return bad("That sight is already gone.", 404);
  if (row.added_by_key !== voterKey(name))
    return bad("Only the person who added it can remove it.", 403);

  await env.DB.prepare("DELETE FROM votes WHERE sight_id = ?1").bind(id).run();
  await env.DB.prepare("DELETE FROM comments WHERE sight_id = ?1").bind(id).run();
  await env.DB.prepare("DELETE FROM booking_status WHERE sight_id = ?1").bind(id).run();
  await env.DB.prepare("DELETE FROM plan_entries WHERE sight_id = ?1").bind(id).run();
  await env.DB.prepare("DELETE FROM items WHERE id = ?1 AND trip_id = ?2").bind(id, trip).run();

  return json({ ok: true, ...(await snapshot(env, trip)) });
}

async function handleAddComment(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const { name: author, error: authError } = await actor(request, env, trip);

  if (authError) return authError;

  const { sightId } = body ?? {};
  if (typeof sightId !== "string" || !(await isKnownSight(env, sightId, trip)))
    return bad("Unknown sight.");

  const text = cleanText(body?.body, 500);
  if (!text) return bad("Write something first.");
  if (text === undefined) return bad("Keep comments under 500 characters.");

  const existing = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM comments WHERE sight_id = ?1"
  )
    .bind(sightId)
    .first();
  if (existing.count >= 50) return bad("That's 50 comments on one option — enough.");

  await env.DB.prepare(
    `INSERT INTO comments (id, sight_id, author, author_key, body, created_at, trip_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(`c-${crypto.randomUUID()}`, sightId, author, voterKey(author), text, Date.now(), trip)
    .run();

  return json({ ok: true, ...(await snapshot(env, trip)) });
}

async function handleRemoveComment(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const { name: name, error: authError } = await actor(request, env, trip);

  if (authError) return authError;
  const { id } = body ?? {};
  if (typeof id !== "string" || !id.startsWith("c-")) return bad("Unknown comment.");

  const row = await env.DB.prepare("SELECT author_key FROM comments WHERE id = ?1")
    .bind(id)
    .first();
  if (!row) return bad("That comment is already gone.", 404);
  if (row.author_key !== voterKey(name))
    return bad("Only the person who wrote it can delete it.", 403);

  await env.DB.prepare("DELETE FROM comments WHERE id = ?1").bind(id).run();
  return json({ ok: true, ...(await snapshot(env, trip)) });
}

/** Sights placed on the plan by hand. Booked ones are not in here. */
async function getPlanEntries(env, trip) {
  const { results } = await env.DB.prepare(
    `SELECT sight_id, day, start_time, end_time, added_by
       FROM plan_entries WHERE trip_id = ?1 ORDER BY day ASC, start_time ASC`
  ).bind(trip).all();
  return (results ?? []).map((r) => ({
    id: r.sight_id,
    day: r.day,
    start: r.start_time,
    end: r.end_time,
    addedBy: r.added_by,
  }));
}

/**
 * Move a sight between the three lists on the Bookings page.
 *
 *   'booked'  → we have it
 *   'skipped' → we've decided against booking it
 *   null      → back to the list of things still to sort out
 *
 * None of this touches votes or the sight itself: it stays on the voting page
 * whatever happens here. Anyone can set it and anyone can undo it — a shared
 * list for a group that trusts each other, same as everything else.
 */
async function handleBookingStatus(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const { name: name, error: authError } = await actor(request, env, trip, "edit");

  if (authError) return authError;

  const { sightId, status } = body ?? {};
  if (typeof sightId !== "string" || !(await isKnownSight(env, sightId, trip)))
    return bad("Unknown sight.");
  if (status !== null && status !== "booked" && status !== "skipped")
    return bad("Status must be booked, skipped, or null.");

  // The slot we actually hold. Only meaningful for a booking, so anything else
  // clears it rather than leaving a date attached to a decision not to go.
  const date = body?.bookedDate == null || body.bookedDate === "" ? null : body.bookedDate;
  const tripDays = new Set((await getTrip(env, trip)).days);
  if (date !== null && (typeof date !== "string" || !tripDays.has(date)))
    return bad("That date isn't a day of this trip.");

  const time = cleanClock(body?.bookedTime);
  if (time === undefined) return bad("The time should look like 14:30.");

  const end = cleanClock(body?.bookedEnd);
  if (end === undefined) return bad("The end time should look like 17:00.");

  if (time && !date) return bad("A time needs a date to go with it.");
  if (end && !time) return bad("An end time needs a start time.");
  if (end && time && end <= time) return bad("It has to end after it starts.");
  if (status !== "booked" && (date || time || end))
    return bad("Only a booking can have a date and time.");

  if (status === null) {
    await env.DB.prepare("DELETE FROM booking_status WHERE sight_id = ?1")
      .bind(sightId)
      .run();
  } else {
    // A booking places the sight itself, so a hand-made entry for it would be
    // a second copy on the same plan. The booking wins.
    if (status === "booked" && date)
      await env.DB.prepare("DELETE FROM plan_entries WHERE sight_id = ?1")
        .bind(sightId).run();

    await env.DB.prepare(
      `INSERT INTO booking_status (sight_id, status, marked_by,
                                   booked_date, booked_time, booked_end, created_at, trip_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT (sight_id) DO UPDATE SET
         status = excluded.status, marked_by = excluded.marked_by,
         booked_date = excluded.booked_date, booked_time = excluded.booked_time,
         booked_end = excluded.booked_end, created_at = excluded.created_at`
    )
      .bind(sightId, status, name, date, time, end, Date.now(), trip)
      .run();
  }

  return json({ ok: true, ...(await snapshot(env, trip)) });
}

/** Who is coming. The key is the lowercased name, same identity as a vote. */
async function getMembers(env, trip) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, name_key, note, added_by, user_id, role FROM trip_members
      WHERE trip_id = ?1 ORDER BY name COLLATE NOCASE`
  ).bind(trip).all();
  return (results ?? []).map((r) => ({
    id: r.id, name: r.name, key: r.name_key, note: r.note, addedBy: r.added_by,
    claimed: !!r.user_id, role: r.role,
  }));
}

/** Getting there and back. At most one row each way. */
async function getTravel(env, trip) {
  const { results } = await env.DB.prepare(
    `SELECT direction, mode, carrier, from_place, to_place,
            depart_date, depart_time, arrive_time, reference, note, set_by
       FROM trip_travel WHERE trip_id = ?1`
  ).bind(trip).all();
  return (results ?? []).map((r) => ({
    direction: r.direction, mode: r.mode, carrier: r.carrier,
    from: r.from_place, to: r.to_place,
    date: r.depart_date, departTime: r.depart_time, arriveTime: r.arrive_time,
    reference: r.reference, note: r.note, setBy: r.set_by,
  }));
}

/** What the trip is: name, destination, dates, and the hotel's details. */
async function handleTripSettings(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const { name: who, error: authError } = await actor(request, env, trip, "own");

  if (authError) return authError;

  const name = cleanText(body?.name, 80);
  if (name === undefined) return bad("Keep the trip name under 80 characters.");
  const destination = cleanText(body?.destination, 80);
  if (destination === undefined) return bad("Keep the destination under 80 characters.");

  const { startDate, endDate } = body ?? {};
  for (const [label, v] of [["start", startDate], ["end", endDate]])
    if (v != null && v !== "" && !isDate(v))
      return bad(`The ${label} date should look like 2026-09-11.`);

  if (startDate && endDate && endDate < startDate)
    return bad("The trip can't end before it starts.");
  if (startDate && endDate && daysBetween(startDate, endDate).length > 60)
    return bad("That's more than sixty days. Split it into separate trips.");

  const checkIn = cleanClock(body?.checkIn);
  if (checkIn === undefined) return bad("Check-in should look like 15:00.");
  const checkOut = cleanClock(body?.checkOut);
  if (checkOut === undefined) return bad("Check-out should look like 11:00.");

  const reference = cleanText(body?.reference, 80);
  if (reference === undefined) return bad("Keep the reference under 80 characters.");
  const phone = cleanText(body?.phone, 40);
  if (phone === undefined) return bad("Keep the phone number under 40 characters.");
  const notes = cleanText(body?.notes, 2000);
  if (notes === undefined) return bad("Keep the notes under 2000 characters.");

  const { visibility, status } = body ?? {};
  if (visibility != null && visibility !== "public" && visibility !== "private")
    return bad("Visibility must be public or private.");
  if (status != null && status !== "planned" && status !== "cancelled")
    return bad("Status must be planned or cancelled.");
  const { currency } = body ?? {};
  if (currency != null && !CURRENCIES.includes(currency)) return bad("That currency isn't one the app knows.");

  // Only what was sent changes; COALESCE keeps the rest.
  await env.DB.prepare(
    `INSERT INTO trips (id, name, destination, start_date, end_date,
                        base_checkin, base_checkout, base_ref, base_phone,
                        notes, set_by, updated_at, created_at, visibility)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, COALESCE(?14, 'private'))
     ON CONFLICT (id) DO UPDATE SET
       name          = COALESCE(excluded.name, trips.name),
       destination   = COALESCE(excluded.destination, trips.destination),
       start_date    = COALESCE(excluded.start_date, trips.start_date),
       end_date      = COALESCE(excluded.end_date, trips.end_date),
       base_checkin  = COALESCE(excluded.base_checkin, trips.base_checkin),
       base_checkout = COALESCE(excluded.base_checkout, trips.base_checkout),
       base_ref      = COALESCE(excluded.base_ref, trips.base_ref),
       base_phone    = COALESCE(excluded.base_phone, trips.base_phone),
       notes         = COALESCE(excluded.notes, trips.notes),
       visibility    = COALESCE(?15, trips.visibility),
       status        = COALESCE(?16, trips.status),
       currency      = COALESCE(?17, trips.currency),
       set_by = excluded.set_by, updated_at = excluded.updated_at`
  )
    .bind(trip, name, destination, startDate || null, endDate || null,
          checkIn, checkOut, reference, phone, notes, who, Date.now(), Date.now(),
          visibility ?? null, visibility ?? null, status ?? null, currency ?? null)
    .run();

  return json({ ok: true, ...(await snapshot(env, trip)) });
}

/** Who is coming. */
async function handleMemberAdd(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const { name: who, error: authError } = await actor(request, env, trip, "own");

  if (authError) return authError;

  const name = cleanName(body?.name);
  if (!name) return bad("A name between 1 and 32 characters.");

  const note = cleanText(body?.note, 120);
  if (note === undefined) return bad("Keep the note under 120 characters.");

  const { count } = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM trip_members WHERE trip_id = ?1"
  ).bind(trip).first();
  if (count >= 50) return bad("Fifty people is not a trip, it's a coach tour.");

  // name_key is unique, so adding someone twice quietly updates the spelling
  // rather than making a second person who owns half their votes.
  await env.DB.prepare(
    `INSERT INTO trip_members (id, name, name_key, note, added_by, created_at, trip_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (trip_id, name_key) DO UPDATE SET name = excluded.name, note = excluded.note`
  )
    .bind(`m-${crypto.randomUUID()}`, name, voterKey(name), note, who, Date.now(), trip)
    .run();

  return json({ ok: true, ...(await snapshot(env, trip)) });
}

async function handleMemberRemove(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }
  const { error: authError } = await actor(request, env, trip, "own");
  if (authError) return authError;

  const { id } = body ?? {};
  if (typeof id !== "string" || !id.startsWith("m-")) return bad("Unknown member.");

  // Votes and comments are keyed on the name, not on this row, so they stay.
  // Taking someone off the list is not the same as erasing what they wanted.
  // An owner cannot be removed: change their role first, and the last owner
  // cannot be changed, so a trip never ends up with nobody running it.
  const target = await env.DB.prepare(
    "SELECT role FROM trip_members WHERE id = ?1 AND trip_id = ?2"
  ).bind(id, trip).first();
  if (!target) return bad("That person isn't on this trip.", 404);
  if (target.role === "owner") return bad("Owners can't be removed. Make them an editor first.");
  await env.DB.prepare("DELETE FROM trip_members WHERE id = ?1 AND trip_id = ?2").bind(id, trip).run();
  return json({ ok: true, ...(await snapshot(env, trip)) });
}

/** How we get there and back. */
async function handleTravel(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const { name: who, error: authError } = await actor(request, env, trip, "own");

  if (authError) return authError;

  const { direction } = body ?? {};
  if (direction !== "out" && direction !== "back")
    return bad("Direction must be out or back.");

  if (body?.clear === true) {
    await env.DB.prepare("DELETE FROM trip_travel WHERE direction = ?1 AND trip_id = ?2")
      .bind(direction, trip).run();
    return json({ ok: true, ...(await snapshot(env, trip)) });
  }

  const text = (v, max, label) => {
    const t = cleanText(v, max);
    if (t === undefined) throw new Error(`Keep the ${label} under ${max} characters.`);
    return t;
  };

  let mode, carrier, from, to, reference, note;
  try {
    mode = text(body?.mode, 30, "kind of travel");
    carrier = text(body?.carrier, 80, "flight or service");
    from = text(body?.from, 80, "departure point");
    to = text(body?.to, 80, "destination");
    reference = text(body?.reference, 80, "reference");
    note = text(body?.note, 300, "note");
  } catch (err) {
    return bad(err.message);
  }

  const { date } = body ?? {};
  if (date != null && date !== "" && !isDate(date))
    return bad("The date should look like 2026-09-11.");

  const departTime = cleanClock(body?.departTime);
  if (departTime === undefined) return bad("The departure should look like 07:15.");
  const arriveTime = cleanClock(body?.arriveTime);
  if (arriveTime === undefined) return bad("The arrival should look like 09:40.");

  await env.DB.prepare(
    `INSERT INTO trip_travel (direction, mode, carrier, from_place, to_place,
                              depart_date, depart_time, arrive_time,
                              reference, note, set_by, updated_at, trip_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
     ON CONFLICT (trip_id, direction) DO UPDATE SET
       mode = excluded.mode, carrier = excluded.carrier,
       from_place = excluded.from_place, to_place = excluded.to_place,
       depart_date = excluded.depart_date, depart_time = excluded.depart_time,
       arrive_time = excluded.arrive_time, reference = excluded.reference,
       note = excluded.note, set_by = excluded.set_by, updated_at = excluded.updated_at`
  )
    .bind(direction, mode, carrier, from, to, date || null,
          departTime, arriveTime, reference, note, who, Date.now(), trip)
    .run();

  return json({ ok: true, ...(await snapshot(env, trip)) });
}

/** Change where the days start, or clear it. */
async function handleTripBase(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const { name: who, error: authError } = await actor(request, env, trip, "own");

  if (authError) return authError;

  const { lat, lon } = body ?? {};
  const name = cleanText(body?.name, 200);
  if (name === undefined) return bad("That address is too long.");

  const clearing = lat == null && lon == null;
  if (!clearing) {
    if (typeof lat !== "number" || typeof lon !== "number" ||
        !Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180)
      return bad("Those coordinates don't look right.");
  }

  await env.DB.prepare(
    `INSERT INTO trips (id, base_name, base_lat, base_lon, set_by, updated_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (id) DO UPDATE SET
       base_name = excluded.base_name, base_lat = excluded.base_lat,
       base_lon = excluded.base_lon, set_by = excluded.set_by,
       updated_at = excluded.updated_at`
  )
    .bind(trip, clearing ? null : name, clearing ? null : lat, clearing ? null : lon,
          who, Date.now(), Date.now())
    .run();

  return json({ ok: true, ...(await snapshot(env, trip)) });
}

async function getPlanNotes(env, trip) {
  const { results } = await env.DB.prepare(
    `SELECT id, day, start_time, end_time, label, added_by, address, lat, lon
       FROM plan_notes WHERE trip_id = ?1 ORDER BY day ASC, start_time ASC`
  ).bind(trip).all();
  return (results ?? []).map((r) => ({
    id: r.id,
    day: r.day,
    start: r.start_time,
    end: r.end_time,
    label: r.label,
    addedBy: r.added_by,
    address: r.address,
    lat: r.lat,
    lon: r.lon,
  }));
}

/** Something on the plan that isn't a sight — a musical, dinner, a train. */
async function handleNoteAdd(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const { name: name, error: authError } = await actor(request, env, trip, "edit");

  if (authError) return authError;

  const label = cleanText(body?.label, 80);
  // undefined means malformed or too long, null means empty. Check the
  // specific case first: `!undefined` is true, so the order matters.
  if (label === undefined) return bad("Keep it under 80 characters.");
  if (!label) return bad("Give it a name — \"Musical\", \"Dinner with Anna\".");

  const { day } = body ?? {};
  if (typeof day !== "string" || !(await getTrip(env, trip)).days.includes(day))
    return bad("That date isn't a day of this trip.");

  const start = cleanClock(body?.start);
  if (start === undefined) return bad("The start should look like 17:00.");
  const end = cleanClock(body?.end);
  if (end === undefined) return bad("The end should look like 21:00.");
  if (end && !start) return bad("An end time needs a start time.");
  if (end && start && end <= start) return bad("It has to end after it starts.");

  // A location can come in with the entry. Optional — an entry with no place
  // is simply left out of the day's route, same as one added without.
  const address = cleanText(body?.address, 200);
  if (address === undefined) return bad("That address is too long.");
  const { lat, lon } = body ?? {};
  const placed = lat != null || lon != null;
  if (placed && (typeof lat !== "number" || typeof lon !== "number" ||
      !Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180))
    return bad("Those coordinates don't look right.");

  const { count } = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM plan_notes WHERE trip_id = ?1"
  ).bind(trip).first();
  if (count >= 200) return bad("That's 200 entries — plenty. Remove some first.");

  await env.DB.prepare(
    `INSERT INTO plan_notes
       (id, day, start_time, end_time, label, added_by, created_at, address, lat, lon, trip_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
  )
    .bind(`note-${crypto.randomUUID()}`, day, start, end, label, name, Date.now(),
          placed ? address : (address ?? null),
          placed ? lat : null, placed ? lon : null, trip)
    .run();

  return json({ ok: true, ...(await snapshot(env, trip)) });
}

/**
 * Change one of your own entries in place.
 *
 * Remove-and-re-add would work but hands it a new id, which loses the address
 * attached to it and breaks anything holding the old one. Only the fields
 * actually sent are changed.
 */
async function handleNoteUpdate(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const { name: who, error: authError } = await actor(request, env, trip, "edit");

  if (authError) return authError;

  const { id } = body ?? {};
  if (typeof id !== "string" || !id.startsWith("note-"))
    return bad("That isn't one of your own entries.");

  const row = await env.DB.prepare("SELECT 1 FROM plan_notes WHERE id = ?1")
    .bind(id).first();
  if (!row) return bad("That entry is already gone.", 404);

  const label = cleanText(body?.label, 80);
  if (label === undefined) return bad("Keep the name under 80 characters.");

  const { day } = body ?? {};
  if (day != null && day !== "") {
    const info = await getTrip(env, trip);
    if (typeof day !== "string" || !info.days.includes(day))
      return bad("That date isn't a day of this trip.");
  }

  const start = cleanClock(body?.start);
  if (start === undefined) return bad("The start should look like 17:00.");
  const end = cleanClock(body?.end);
  if (end === undefined) return bad("The end should look like 21:00.");

  // Compare against what is already stored, not just what was sent, or an edit
  // that only changes the end time can slip past the ordering check.
  const current = await env.DB.prepare(
    "SELECT day, start_time, end_time FROM plan_notes WHERE id = ?1"
  ).bind(id).first();
  const nextStart = body?.start !== undefined ? start : current.start_time;
  const nextEnd = body?.end !== undefined ? end : current.end_time;
  if (nextEnd && !nextStart) return bad("An end time needs a start time.");
  if (nextEnd && nextStart && nextEnd <= nextStart)
    return bad("It has to end after it starts.");

  await env.DB.prepare(
    `UPDATE plan_notes SET
       label      = COALESCE(?1, label),
       day        = COALESCE(?2, day),
       start_time = ?3,
       end_time   = ?4
     WHERE id = ?5`
  )
    .bind(label, day || null, nextStart, nextEnd, id)
    .run();

  return json({ ok: true, ...(await snapshot(env, trip)) });
}

async function handleNoteRemove(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }
  const { error: authError } = await actor(request, env, trip, "edit");
  if (authError) return authError;

  const { id } = body ?? {};
  if (typeof id !== "string" || !id.startsWith("note-"))
    return bad("That isn't one of your own entries.");

  await env.DB.prepare("DELETE FROM plan_notes WHERE id = ?1").bind(id).run();
  return json({ ok: true, ...(await snapshot(env, trip)) });
}

/**
 * Put a sight on the plan by hand, or move one already there.
 *
 * This is for everything with nothing to book — those never get a date any
 * other way. Anything booked with a date is placed by its booking instead, and
 * is refused here so the same sight can't appear on the plan twice.
 */
async function handlePlanSet(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const { name: name, error: authError } = await actor(request, env, trip, "edit");

  if (authError) return authError;

  const { sightId, day } = body ?? {};
  if (typeof sightId !== "string" || !(await isKnownSight(env, sightId, trip)))
    return bad("Unknown sight.");
  if (typeof day !== "string" || !(await getTrip(env, trip)).days.includes(day))
    return bad("That date isn't a day of this trip.");

  const start = cleanClock(body?.start);
  if (start === undefined) return bad("The start should look like 10:00.");
  const end = cleanClock(body?.end);
  if (end === undefined) return bad("The end should look like 12:30.");
  if (end && !start) return bad("An end time needs a start time.");
  if (end && start && end <= start) return bad("It has to end after it starts.");

  const booked = await env.DB.prepare(
    `SELECT 1 FROM booking_status
      WHERE sight_id = ?1 AND status = 'booked' AND booked_date IS NOT NULL`
  ).bind(sightId).first();
  if (booked)
    return bad("That one is already on the plan from its booking. Change the slot on the Bookings page.");

  await env.DB.prepare(
    `INSERT INTO plan_entries (sight_id, day, start_time, end_time, added_by, created_at, trip_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (sight_id) DO UPDATE SET
       day = excluded.day, start_time = excluded.start_time,
       end_time = excluded.end_time, added_by = excluded.added_by,
       created_at = excluded.created_at`
  )
    .bind(sightId, day, start, end, name, Date.now(), trip)
    .run();

  return json({ ok: true, ...(await snapshot(env, trip)) });
}

async function handlePlanRemove(request, env, trip) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }
  const { error: authError } = await actor(request, env, trip, "edit");
  if (authError) return authError;

  const { sightId } = body ?? {};
  if (typeof sightId !== "string") return bad("Unknown sight.");

  await env.DB.prepare("DELETE FROM plan_entries WHERE sight_id = ?1")
    .bind(sightId)
    .run();
  return json({ ok: true, ...(await snapshot(env, trip)) });
}

/* ------------------------------------------------------------------ entry */

export default {
  async fetch(request, env) {
    return withHeaders(await route(request, env));
  },
};

async function route(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/auth" && request.method === "GET")
      return handleAuthCallback(request, env, url);
    if (url.pathname === "/invite" && request.method === "GET")
      return handleInviteAccept(request, env, url, { voterKey });
    if (!url.pathname.startsWith("/api/")) return servePage(request, env, url);

    const { method } = request;

    // Writes are limited per account (per address if not signed in);
    // address lookups more tightly; sign-in mail most tightly of all.
    if (method === "POST") {
      const who = (await currentUser(request, env))?.id || ip(request);
      const over = (url.pathname === "/api/auth/request" || url.pathname === "/api/auth/login") ? await limited(env, "RL_AUTH", ip(request))
        : /\/api\/t\/[^/]+\/geocode$/.test(url.pathname) ? await limited(env, "RL_GEO", who)
        : await limited(env, "RL_WRITE", who);
      if (over) return over;
    }

    // Accounts, and the list of trips, are not part of any trip.
    if (url.pathname === "/api/trips" && method === "GET") return handleTripList(request, env);
    if (url.pathname === "/api/trips" && method === "POST") return handleTripCreate(request, env);
    if (url.pathname === "/api/auth/pin" && method === "POST") return handlePin(request, env);
    if (url.pathname === "/api/auth/delete" && method === "POST") return handleAccountDelete(request, env, url);
    if (url.pathname === "/api/meta" && method === "GET") return json({ contact: env.CONTACT_EMAIL || null });
    if (url.pathname === "/api/templates" && method === "GET")
      return json({ templates: templatesFor(url.searchParams.get("destination")) });
    if (url.pathname === "/api/examples" && method === "GET") return json({ examples: await publicTrips(env) });
    if (url.pathname === "/api/auth/request" && method === "POST") return handleAuthRequest(request, env);
    if (url.pathname === "/api/auth/me" && method === "GET") return handleAuthMe(request, env);
    if (url.pathname === "/api/auth/logout" && method === "POST") return handleAuthLogout(request, env, url);
    if (url.pathname === "/api/auth/settings" && method === "POST") return handleAuthSettings(request, env);
    if (url.pathname === "/api/auth/password" && method === "POST") return handlePasswordSet(request, env);
    if (url.pathname === "/api/auth/password/clear" && method === "POST") return handlePasswordClear(request, env);
    if (url.pathname === "/api/auth/login" && method === "POST") return handlePasswordLogin(request, env, url);

    const { trip, path: pathname } = tripOf(url);
    if (!(await tripExists(env, trip))) return bad("No such trip.", 404);

    if (pathname === "/api/me" && method === "GET")
      return handleWhoAmI(request, env, trip);

    // Everything from here is for members of the trip.
    const ctx = { actor, cleanName, voterKey, tripName: async (env, t) => (await getTrip(env, t)).name };
    const mctx = { actor, cleanText, voterKey, getTrip, getMembers, isKnownSight, snapshot };

    if (pathname === "/api/sights" && method === "GET") {
      const { member, error } = await reader(request, env, trip);
      if (error) return error;
      return json({ sights: await getSights(env, trip), ...(await snapshot(env, trip)),
                    ...(member?.role === "owner" ? { invites: await listInvites(env, trip) } : {}) });
    }

    if (pathname === "/api/state" && method === "GET") {
      const { error } = await reader(request, env, trip);
      if (error) return error;
      return json(await snapshot(env, trip));
    }

    if (pathname === "/api/photos" && method === "GET")
      return handlePhotos(request, env, trip);

    if (pathname === "/api/money" && method === "GET") {
      const { error } = await reader(request, env, trip);
      if (error) return error;
      const [expenses, members, info] = await Promise.all([getExpenses(env, trip), getMembers(env, trip), getTrip(env, trip)]);
      return json({ currency: info.currency, expenses, members, ...balances(expenses, members) });
    }
    if (pathname === "/api/expense/add" && method === "POST") return handleExpenseAdd(request, env, trip, mctx);
    if (pathname === "/api/expense/update" && method === "POST") return handleExpenseUpdate(request, env, trip, mctx);
    if (pathname === "/api/expense/remove" && method === "POST") return handleExpenseRemove(request, env, trip, mctx);

    if (pathname === "/api/invite" && method === "POST")
      return handleInviteCreate(request, env, trip, ctx);
    if (pathname === "/api/invites" && method === "GET")
      return handleInviteList(request, env, trip, ctx);
    if (pathname === "/api/invite/revoke" && method === "POST")
      return handleInviteRevoke(request, env, trip, ctx);
    if (pathname === "/api/trip/member/role" && method === "POST")
      return handleMemberRole(request, env, trip);
    if (pathname === "/api/leave" && method === "POST")
      return handleLeave(request, env, trip);
    if (pathname === "/api/trip/delete" && method === "POST")
      return handleTripDelete(request, env, trip);

    if (pathname === "/api/vote" && method === "POST")
      return handleVote(request, env, trip);

    if (pathname === "/api/sights/add" && method === "POST")
      return handleAddSight(request, env, trip);

    if (pathname === "/api/geocode" && method === "POST")
      return handleGeocode(request, env, trip);

    if (pathname === "/api/sights/address" && method === "POST")
      return handleSightAddress(request, env, trip);

    if (pathname === "/api/plan/note/address" && method === "POST")
      return handleNoteAddress(request, env, trip);

    if (pathname === "/api/trip/base" && method === "POST")
      return handleTripBase(request, env, trip);

    if (pathname === "/api/trip/settings" && method === "POST")
      return handleTripSettings(request, env, trip);

    if (pathname === "/api/trip/member/add" && method === "POST")
      return handleMemberAdd(request, env, trip);

    if (pathname === "/api/trip/member/remove" && method === "POST")
      return handleMemberRemove(request, env, trip);

    if (pathname === "/api/trip/travel" && method === "POST")
      return handleTravel(request, env, trip);

    if (pathname === "/api/sights/edit" && method === "POST")
      return handleEditSight(request, env, trip);

    if (pathname === "/api/sights/remove" && method === "POST")
      return handleDeleteSight(request, env, trip);

    if (pathname === "/api/comments/add" && method === "POST")
      return handleAddComment(request, env, trip);

    if (pathname === "/api/comments/remove" && method === "POST")
      return handleRemoveComment(request, env, trip);

    if (pathname === "/api/bookings/status" && method === "POST")
      return handleBookingStatus(request, env, trip);

    if (pathname === "/api/plan/set" && method === "POST")
      return handlePlanSet(request, env, trip);

    if (pathname === "/api/plan/remove" && method === "POST")
      return handlePlanRemove(request, env, trip);

    if (pathname === "/api/plan/note/add" && method === "POST")
      return handleNoteAdd(request, env, trip);

    if (pathname === "/api/plan/note/update" && method === "POST")
      return handleNoteUpdate(request, env, trip);

    if (pathname === "/api/plan/note/remove" && method === "POST")
      return handleNoteRemove(request, env, trip);

    return bad("Not found.", 404);
}
