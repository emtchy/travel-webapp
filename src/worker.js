import { SIGHTS } from "./sights.js";

/* ------------------------------------------------------------------ utils */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

const bad = (message, status = 400) => json({ error: message }, status);

const BUILT_IN_IDS = new Set(SIGHTS.map((s) => s.id));

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

/** Optional shared passphrase. Unset => open access. */
function checkAccess(request, env) {
  const expected = env.ACCESS_CODE;
  if (!expected) return true;
  const supplied =
    request.headers.get("x-access-code") ||
    new URL(request.url).searchParams.get("code");
  return supplied === expected;
}

/* --------------------------------------------------------------- database */

async function getVotes(env) {
  const { results } = await env.DB.prepare(
    "SELECT sight_id, voter_name FROM votes ORDER BY created_at ASC"
  ).all();

  const byId = {};
  for (const row of results ?? []) (byId[row.sight_id] ||= []).push(row.voter_name);
  return byId;
}

async function getCustom(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, summary, url, added_by, created_at,
            costs, price_label, booking_required
       FROM custom_sights ORDER BY created_at ASC`
  ).all();

  return (results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    summary: row.summary,
    url: row.url,
    addedBy: row.added_by,
    createdAt: row.created_at,
    costs: !!row.costs,
    priceLabel: row.price_label,
    bookingRequired: !!row.booking_required,
    custom: true,
  }));
}

/**
 * Booked, or decided against. Anything not listed here is still to be sorted
 * out, which is the common case and costs no storage.
 */
async function getBookingStatus(env) {
  const { results } = await env.DB.prepare(
    `SELECT sight_id, status, marked_by, booked_date, booked_time, created_at
       FROM booking_status ORDER BY created_at ASC`
  ).all();
  return (results ?? []).map((r) => ({
    id: r.sight_id,
    status: r.status,
    by: r.marked_by,
    date: r.booked_date,
    time: r.booked_time,
    at: r.created_at,
  }));
}

async function isKnownSight(env, id) {
  if (BUILT_IN_IDS.has(id)) return true;
  const row = await env.DB.prepare("SELECT 1 FROM custom_sights WHERE id = ?1")
    .bind(id)
    .first();
  return !!row;
}

async function getComments(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, sight_id, author, body, created_at
       FROM comments ORDER BY created_at ASC`
  ).all();

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
const snapshot = async (env) => ({
  custom: await getCustom(env),
  votes: await getVotes(env),
  comments: await getComments(env),
  bookings: await getBookingStatus(env),
});

/* ------------------------------------------------------------- handlers */

async function handleVote(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const { sightId, wanted } = body ?? {};
  const name = cleanName(body?.voter);

  if (!name) return bad("Enter a name between 1 and 32 characters.");
  if (typeof sightId !== "string" || !(await isKnownSight(env, sightId)))
    return bad("Unknown sight.");
  if (typeof wanted !== "boolean") return bad("`wanted` must be true or false.");

  if (wanted) {
    await env.DB.prepare(
      `INSERT INTO votes (sight_id, voter_key, voter_name, created_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (sight_id, voter_key)
       DO UPDATE SET voter_name = excluded.voter_name`
    )
      .bind(sightId, voterKey(name), name, Date.now())
      .run();
  } else {
    await env.DB.prepare(
      "DELETE FROM votes WHERE sight_id = ?1 AND voter_key = ?2"
    )
      .bind(sightId, voterKey(name))
      .run();
  }

  return json({ ok: true, ...(await snapshot(env)) });
}

async function handleAddSight(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const addedBy = cleanName(body?.voter);
  if (!addedBy) return bad("Enter your name first.");

  const name = cleanText(body?.name, 80);
  if (!name) return bad("A name is required (up to 80 characters).");
  if (name === undefined) return bad("That name is too long or has odd characters.");

  const summary = cleanText(body?.summary, 300);
  if (summary === undefined) return bad("Keep the description under 300 characters.");

  const url = cleanUrl(body?.url);
  if (url === undefined) return bad("That link doesn't look like a web address.");

  const costs = body?.costs === true;
  const bookingRequired = body?.bookingRequired === true;

  const priceLabel = cleanText(body?.priceLabel, 40);
  if (priceLabel === undefined) return bad("Keep the price under 40 characters.");

  const { count } = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM custom_sights"
  ).first();
  if (count >= 100) return bad("That's 100 added sights — plenty. Remove some first.");

  const duplicate = await env.DB.prepare(
    "SELECT 1 FROM custom_sights WHERE lower(name) = lower(?1)"
  )
    .bind(name)
    .first();
  if (duplicate) return bad("Someone already added that one.");

  const id = `custom-${crypto.randomUUID()}`;

  await env.DB.prepare(
    `INSERT INTO custom_sights (id, name, summary, url, added_by, added_by_key,
                                created_at, costs, price_label, booking_required)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  )
    .bind(id, name, summary, url, addedBy, voterKey(addedBy), Date.now(),
          costs ? 1 : 0, priceLabel, bookingRequired ? 1 : 0)
    .run();

  // Adding something counts as wanting it.
  await env.DB.prepare(
    `INSERT INTO votes (sight_id, voter_key, voter_name, created_at)
     VALUES (?1, ?2, ?3, ?4)`
  )
    .bind(id, voterKey(addedBy), addedBy, Date.now())
    .run();

  return json({ ok: true, id, ...(await snapshot(env)) });
}

async function handleDeleteSight(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const name = cleanName(body?.voter);
  const { id } = body ?? {};
  if (!name) return bad("Enter your name first.");
  if (typeof id !== "string" || !id.startsWith("custom-"))
    return bad("Only added sights can be removed.");

  const row = await env.DB.prepare(
    "SELECT added_by_key FROM custom_sights WHERE id = ?1"
  )
    .bind(id)
    .first();
  if (!row) return bad("That sight is already gone.", 404);
  if (row.added_by_key !== voterKey(name))
    return bad("Only the person who added it can remove it.", 403);

  await env.DB.prepare("DELETE FROM votes WHERE sight_id = ?1").bind(id).run();
  await env.DB.prepare("DELETE FROM comments WHERE sight_id = ?1").bind(id).run();
  await env.DB.prepare("DELETE FROM booking_status WHERE sight_id = ?1").bind(id).run();
  await env.DB.prepare("DELETE FROM custom_sights WHERE id = ?1").bind(id).run();

  return json({ ok: true, ...(await snapshot(env)) });
}

async function handleAddComment(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const author = cleanName(body?.voter);
  if (!author) return bad("Enter your name first.");

  const { sightId } = body ?? {};
  if (typeof sightId !== "string" || !(await isKnownSight(env, sightId)))
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
    `INSERT INTO comments (id, sight_id, author, author_key, body, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  )
    .bind(`c-${crypto.randomUUID()}`, sightId, author, voterKey(author), text, Date.now())
    .run();

  return json({ ok: true, ...(await snapshot(env)) });
}

async function handleRemoveComment(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const name = cleanName(body?.voter);
  const { id } = body ?? {};
  if (!name) return bad("Enter your name first.");
  if (typeof id !== "string" || !id.startsWith("c-")) return bad("Unknown comment.");

  const row = await env.DB.prepare("SELECT author_key FROM comments WHERE id = ?1")
    .bind(id)
    .first();
  if (!row) return bad("That comment is already gone.", 404);
  if (row.author_key !== voterKey(name))
    return bad("Only the person who wrote it can delete it.", 403);

  await env.DB.prepare("DELETE FROM comments WHERE id = ?1").bind(id).run();
  return json({ ok: true, ...(await snapshot(env)) });
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
async function handleBookingStatus(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const name = cleanName(body?.voter);
  if (!name) return bad("Enter your name first.");

  const { sightId, status } = body ?? {};
  if (typeof sightId !== "string" || !(await isKnownSight(env, sightId)))
    return bad("Unknown sight.");
  if (status !== null && status !== "booked" && status !== "skipped")
    return bad("Status must be booked, skipped, or null.");

  // The slot we actually hold. Only meaningful for a booking, so anything else
  // clears it rather than leaving a date attached to a decision not to go.
  const date = body?.bookedDate == null || body.bookedDate === "" ? null : body.bookedDate;
  if (date !== null && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)))
    return bad("The date should look like 2026-09-14.");

  const time = body?.bookedTime == null || body.bookedTime === "" ? null : body.bookedTime;
  if (time !== null && (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))
    return bad("The time should look like 14:30.");

  if (time && !date) return bad("A time needs a date to go with it.");
  if (status !== "booked" && (date || time))
    return bad("Only a booking can have a date and time.");

  if (status === null) {
    await env.DB.prepare("DELETE FROM booking_status WHERE sight_id = ?1")
      .bind(sightId)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO booking_status (sight_id, status, marked_by,
                                   booked_date, booked_time, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (sight_id) DO UPDATE SET
         status = excluded.status, marked_by = excluded.marked_by,
         booked_date = excluded.booked_date, booked_time = excluded.booked_time,
         created_at = excluded.created_at`
    )
      .bind(sightId, status, name, date, time, Date.now())
      .run();
  }

  return json({ ok: true, ...(await snapshot(env)) });
}

/* ------------------------------------------------------------------ entry */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    if (!checkAccess(request, env)) return json({ error: "Wrong access code." }, 401);

    const { pathname } = url;
    const { method } = request;

    if (pathname === "/api/sights" && method === "GET")
      return json({ sights: SIGHTS, ...(await snapshot(env)) });

    if (pathname === "/api/state" && method === "GET")
      return json(await snapshot(env));

    if (pathname === "/api/vote" && method === "POST")
      return handleVote(request, env);

    if (pathname === "/api/sights/add" && method === "POST")
      return handleAddSight(request, env);

    if (pathname === "/api/sights/remove" && method === "POST")
      return handleDeleteSight(request, env);

    if (pathname === "/api/comments/add" && method === "POST")
      return handleAddComment(request, env);

    if (pathname === "/api/comments/remove" && method === "POST")
      return handleRemoveComment(request, env);

    if (pathname === "/api/bookings/status" && method === "POST")
      return handleBookingStatus(request, env);

    return bad("Not found.", 404);
  },
};
