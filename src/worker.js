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
    `SELECT id, name, summary, url, added_by, created_at
       FROM custom_sights ORDER BY created_at ASC`
  ).all();

  return (results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    summary: row.summary,
    url: row.url,
    addedBy: row.added_by,
    createdAt: row.created_at,
    custom: true,
  }));
}

async function isKnownSight(env, id) {
  if (BUILT_IN_IDS.has(id)) return true;
  const row = await env.DB.prepare("SELECT 1 FROM custom_sights WHERE id = ?1")
    .bind(id)
    .first();
  return !!row;
}

/** Everything the page needs, so a mutation never needs a follow-up GET. */
const snapshot = async (env) => ({
  custom: await getCustom(env),
  votes: await getVotes(env),
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
    `INSERT INTO custom_sights (id, name, summary, url, added_by, added_by_key, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(id, name, summary, url, addedBy, voterKey(addedBy), Date.now())
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
  await env.DB.prepare("DELETE FROM custom_sights WHERE id = ?1").bind(id).run();

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

    return bad("Not found.", 404);
  },
};
