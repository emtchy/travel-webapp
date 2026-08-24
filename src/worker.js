import { SIGHTS } from "./sights.js";

/* ------------------------------------------------------------------ utils */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });

const bad = (message, status = 400) => json({ error: message }, status);

const VALID_IDS = new Set(SIGHTS.map((s) => s.id));

/** Display name -> stable key. Two people typing "Anna" and "anna " are one voter. */
function voterKey(name) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function cleanName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 32) return null;
  // Reject control characters; everything printable is fine.
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
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

/* -------------------------------------------------------------------- api */

async function getVotes(env) {
  const { results } = await env.DB.prepare(
    "SELECT sight_id, voter_name FROM votes ORDER BY created_at ASC"
  ).all();

  const byId = {};
  for (const row of results ?? []) {
    (byId[row.sight_id] ||= []).push(row.voter_name);
  }
  return byId;
}

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
  if (!VALID_IDS.has(sightId)) return bad("Unknown sight.");
  if (typeof wanted !== "boolean") return bad("`wanted` must be true or false.");

  const key = voterKey(name);

  if (wanted) {
    // Re-voting refreshes the display name but keeps the original timestamp.
    await env.DB.prepare(
      `INSERT INTO votes (sight_id, voter_key, voter_name, created_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (sight_id, voter_key)
       DO UPDATE SET voter_name = excluded.voter_name`
    )
      .bind(sightId, key, name, Date.now())
      .run();
  } else {
    await env.DB.prepare(
      "DELETE FROM votes WHERE sight_id = ?1 AND voter_key = ?2"
    )
      .bind(sightId, key)
      .run();
  }

  return json({ ok: true, votes: await getVotes(env) });
}

/* ------------------------------------------------------------------ entry */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      // Everything else is a static file, served by the [assets] binding.
      return env.ASSETS.fetch(request);
    }

    if (!checkAccess(request, env)) {
      return json({ error: "Wrong access code." }, 401);
    }

    // GET /api/sights — the list plus current votes, in one round trip.
    if (url.pathname === "/api/sights" && request.method === "GET") {
      return json({ sights: SIGHTS, votes: await getVotes(env) });
    }

    // GET /api/votes — votes only, for polling.
    if (url.pathname === "/api/votes" && request.method === "GET") {
      return json({ votes: await getVotes(env) });
    }

    // POST /api/vote — toggle one person's vote on one sight.
    if (url.pathname === "/api/vote" && request.method === "POST") {
      return handleVote(request, env);
    }

    return bad("Not found.", 404);
  },
};
