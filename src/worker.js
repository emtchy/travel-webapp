import { SIGHTS } from "./sights.js";
import { parseMapLink, isShortMapLink, mapSearchTerm } from "./maplink.js";

/* ------------------------------------------------------------------ utils */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

const bad = (message, status = 400) => json({ error: message }, status);

const BUILT_IN_IDS = new Set(SIGHTS.map((s) => s.id));

/** The trip these pages plan. One place, so no page hardcodes its own dates. */
const TRIP = {
  name: "London",
  days: ["2026-09-11", "2026-09-12", "2026-09-13",
         "2026-09-14", "2026-09-15", "2026-09-16"],
  // Roughly the middle of where we are going. Only used to bias address
  // searches, so a "National Gallery" finds this one and not another country's.
  near: { lat: 51.5074, lon: -0.1278 },
};
const TRIP_DAYS = new Set(TRIP.days);

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
            costs, price_label, booking_required, address, lat, lon
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
    address: row.address,
    lat: row.lat,
    lon: row.lon,
    custom: true,
  }));
}

/**
 * Booked, or decided against. Anything not listed here is still to be sorted
 * out, which is the common case and costs no storage.
 */
async function getBookingStatus(env) {
  const { results } = await env.DB.prepare(
    `SELECT sight_id, status, marked_by, booked_date, booked_time, booked_end,
            created_at
       FROM booking_status ORDER BY created_at ASC`
  ).all();
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
  plan: await getPlanEntries(env),
  notes: await getPlanNotes(env),
  trip: TRIP,
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

/**
 * Change whether an added sight costs anything or needs booking.
 *
 * Anyone can set these, unlike removal which stays with whoever added it. They
 * are facts about the place rather than something owned — and the person who
 * knows a tour has to be booked is often not the person who added it.
 */
async function handleEditSight(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const name = cleanName(body?.voter);
  if (!name) return bad("Enter your name first.");

  const { id, costs, bookingRequired } = body ?? {};
  if (typeof id !== "string" || !id.startsWith("custom-"))
    return bad("Only added sights can be edited here.");
  if (typeof costs !== "boolean") return bad("`costs` must be true or false.");
  if (typeof bookingRequired !== "boolean")
    return bad("`bookingRequired` must be true or false.");

  const row = await env.DB.prepare("SELECT 1 FROM custom_sights WHERE id = ?1")
    .bind(id).first();
  if (!row) return bad("That sight is already gone.", 404);

  const priceLabel = cleanText(body?.priceLabel, 40);
  if (priceLabel === undefined) return bad("Keep the price under 40 characters.");

  await env.DB.prepare(
    `UPDATE custom_sights
        SET costs = ?1, price_label = ?2, booking_required = ?3
      WHERE id = ?4`
  )
    .bind(costs ? 1 : 0, costs ? priceLabel : null, bookingRequired ? 1 : 0, id)
    .run();

  return json({ ok: true, ...(await snapshot(env)) });
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
async function handleGeocode(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }
  if (!cleanName(body?.voter)) return bad("Enter your name first.");

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
  const { lat, lon } = TRIP.near;
  const d = 0.6; // roughly 60 km, wide enough for a day trip out of town

  let results;
  try {
    const res = await fetch(
      "https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=0" +
      `&viewbox=${lon - d},${lat + d},${lon + d},${lat - d}` +
      `&q=${encodeURIComponent(term)}`,
      { headers: { "user-agent": "travel-webapp/1.0 (group trip planner)" } });
    if (!res.ok) return bad(`The lookup service answered ${res.status}. Try again shortly.`, 502);
    results = await res.json();
  } catch {
    return bad("Couldn't reach the lookup service. Try again shortly.", 502);
  }

  return json({ ok: true, results: (Array.isArray(results) ? results : []).slice(0, 5)
    .map((r) => ({ label: r.display_name,
                   lat: Math.round(Number(r.lat) * 10000) / 10000,
                   lon: Math.round(Number(r.lon) * 10000) / 10000 })) });
}

/**
 * Give a location to an added sight or to one of your own plan entries, or
 * take it away again. The rules are the same for both, so is the handler —
 * only the table and the id prefix differ.
 */
function makeAddressHandler({ table, prefix, missing, wrongKind }) {
  return async function handleAddress(request, env) {
    let body;
    try {
      body = await request.json();
    } catch {
      return bad("Body must be JSON.");
    }

    const name = cleanName(body?.voter);
    if (!name) return bad("Enter your name first.");

    const { id, lat, lon } = body ?? {};
    if (typeof id !== "string" || !id.startsWith(prefix)) return bad(wrongKind);

    const row = await env.DB.prepare(`SELECT 1 FROM ${table} WHERE id = ?1`)
      .bind(id).first();
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
      `UPDATE ${table} SET address = ?1, lat = ?2, lon = ?3 WHERE id = ?4`
    )
      .bind(clearing ? null : address, clearing ? null : lat, clearing ? null : lon, id)
      .run();

    return json({ ok: true, ...(await snapshot(env)) });
  };
}

const handleSightAddress = makeAddressHandler({
  table: "custom_sights", prefix: "custom-",
  missing: "That sight is already gone.",
  wrongKind: "Only added sights need an address filling in.",
});

const handleNoteAddress = makeAddressHandler({
  table: "plan_notes", prefix: "note-",
  missing: "That entry is already gone.",
  wrongKind: "That isn't one of your own entries.",
});

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
  await env.DB.prepare("DELETE FROM plan_entries WHERE sight_id = ?1").bind(id).run();
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

/** Sights placed on the plan by hand. Booked ones are not in here. */
async function getPlanEntries(env) {
  const { results } = await env.DB.prepare(
    `SELECT sight_id, day, start_time, end_time, added_by
       FROM plan_entries ORDER BY day ASC, start_time ASC`
  ).all();
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
  if (date !== null && (typeof date !== "string" || !TRIP_DAYS.has(date)))
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
                                   booked_date, booked_time, booked_end, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (sight_id) DO UPDATE SET
         status = excluded.status, marked_by = excluded.marked_by,
         booked_date = excluded.booked_date, booked_time = excluded.booked_time,
         booked_end = excluded.booked_end, created_at = excluded.created_at`
    )
      .bind(sightId, status, name, date, time, end, Date.now())
      .run();
  }

  return json({ ok: true, ...(await snapshot(env)) });
}

async function getPlanNotes(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, day, start_time, end_time, label, added_by, address, lat, lon
       FROM plan_notes ORDER BY day ASC, start_time ASC`
  ).all();
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
async function handleNoteAdd(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const name = cleanName(body?.voter);
  if (!name) return bad("Enter your name first.");

  const label = cleanText(body?.label, 80);
  // undefined means malformed or too long, null means empty. Check the
  // specific case first: `!undefined` is true, so the order matters.
  if (label === undefined) return bad("Keep it under 80 characters.");
  if (!label) return bad("Give it a name — \"Musical\", \"Dinner with Anna\".");

  const { day } = body ?? {};
  if (typeof day !== "string" || !TRIP_DAYS.has(day))
    return bad("That date isn't a day of this trip.");

  const start = cleanClock(body?.start);
  if (start === undefined) return bad("The start should look like 17:00.");
  const end = cleanClock(body?.end);
  if (end === undefined) return bad("The end should look like 21:00.");
  if (end && !start) return bad("An end time needs a start time.");
  if (end && start && end <= start) return bad("It has to end after it starts.");

  const { count } = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM plan_notes"
  ).first();
  if (count >= 200) return bad("That's 200 entries — plenty. Remove some first.");

  await env.DB.prepare(
    `INSERT INTO plan_notes (id, day, start_time, end_time, label, added_by, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(`note-${crypto.randomUUID()}`, day, start, end, label, name, Date.now())
    .run();

  return json({ ok: true, ...(await snapshot(env)) });
}

async function handleNoteRemove(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }
  if (!cleanName(body?.voter)) return bad("Enter your name first.");

  const { id } = body ?? {};
  if (typeof id !== "string" || !id.startsWith("note-"))
    return bad("That isn't one of your own entries.");

  await env.DB.prepare("DELETE FROM plan_notes WHERE id = ?1").bind(id).run();
  return json({ ok: true, ...(await snapshot(env)) });
}

/**
 * Put a sight on the plan by hand, or move one already there.
 *
 * This is for everything with nothing to book — those never get a date any
 * other way. Anything booked with a date is placed by its booking instead, and
 * is refused here so the same sight can't appear on the plan twice.
 */
async function handlePlanSet(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }

  const name = cleanName(body?.voter);
  if (!name) return bad("Enter your name first.");

  const { sightId, day } = body ?? {};
  if (typeof sightId !== "string" || !(await isKnownSight(env, sightId)))
    return bad("Unknown sight.");
  if (typeof day !== "string" || !TRIP_DAYS.has(day))
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
    `INSERT INTO plan_entries (sight_id, day, start_time, end_time, added_by, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (sight_id) DO UPDATE SET
       day = excluded.day, start_time = excluded.start_time,
       end_time = excluded.end_time, added_by = excluded.added_by,
       created_at = excluded.created_at`
  )
    .bind(sightId, day, start, end, name, Date.now())
    .run();

  return json({ ok: true, ...(await snapshot(env)) });
}

async function handlePlanRemove(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON.");
  }
  if (!cleanName(body?.voter)) return bad("Enter your name first.");

  const { sightId } = body ?? {};
  if (typeof sightId !== "string") return bad("Unknown sight.");

  await env.DB.prepare("DELETE FROM plan_entries WHERE sight_id = ?1")
    .bind(sightId)
    .run();
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

    if (pathname === "/api/geocode" && method === "POST")
      return handleGeocode(request, env);

    if (pathname === "/api/sights/address" && method === "POST")
      return handleSightAddress(request, env);

    if (pathname === "/api/plan/note/address" && method === "POST")
      return handleNoteAddress(request, env);

    if (pathname === "/api/sights/edit" && method === "POST")
      return handleEditSight(request, env);

    if (pathname === "/api/sights/remove" && method === "POST")
      return handleDeleteSight(request, env);

    if (pathname === "/api/comments/add" && method === "POST")
      return handleAddComment(request, env);

    if (pathname === "/api/comments/remove" && method === "POST")
      return handleRemoveComment(request, env);

    if (pathname === "/api/bookings/status" && method === "POST")
      return handleBookingStatus(request, env);

    if (pathname === "/api/plan/set" && method === "POST")
      return handlePlanSet(request, env);

    if (pathname === "/api/plan/remove" && method === "POST")
      return handlePlanRemove(request, env);

    if (pathname === "/api/plan/note/add" && method === "POST")
      return handleNoteAdd(request, env);

    if (pathname === "/api/plan/note/remove" && method === "POST")
      return handleNoteRemove(request, env);

    return bad("Not found.", 404);
  },
};
