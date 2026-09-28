/**
 * Notes on a stop and on a day: one short shared text per thing — a place,
 * one of your own entries, or a day of the trip — that any editor can write
 * or rewrite in place. "Side entrance on Tower Hill, tickets on Anna's
 * phone." "Sunday: the markets, most shops shut at five." Everyone on the
 * trip reads them; the last edit wins and says who made it.
 *
 * Called memos in the code because `plan_notes` — your own entries on the
 * plan — took the word first. The pages say "note".
 */
import { json, bad } from "./http.js";

export const MAX_MEMO = 2000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The text fit to keep: line endings normalised, trailing spaces and control
 * characters gone, at most one blank line in a row, trimmed. Line breaks
 * stay — a note is a few lines, not a name. Null means "no note"; undefined
 * means invalid.
 */
export function cleanMemo(raw) {
  if (raw == null) return null;
  if (typeof raw !== "string") return undefined;
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .split("\n").map((line) => line.replace(/[ \t]+$/, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  if (text.length > MAX_MEMO) return undefined;
  return text;
}

const rowOf = (r) => ({ text: r.text, by: r.set_by, updatedAt: r.updated_at });

/** Every note on the trip, by what it is on: `{ [target]: { text, by, updatedAt } }`. */
export async function listMemos(env, trip) {
  const { results } = await env.DB.prepare(
    "SELECT target, text, set_by, updated_at FROM memos WHERE trip_id = ?1"
  ).bind(trip).all();
  const out = {};
  for (const r of results ?? []) out[r.target] = rowOf(r);
  return out;
}

/** The note on one day, for the front page's "today", or null. */
export async function memoOn(env, trip, target) {
  const r = await env.DB.prepare(
    "SELECT target, text, set_by, updated_at FROM memos WHERE trip_id = ?1 AND target = ?2"
  ).bind(trip, target).first();
  return r ? rowOf(r) : null;
}

/**
 * POST /api/t/<trip>/memo/set  { target, text | null }
 * Editors. The target is a place or an entry on the trip, or one of its
 * days. An empty text takes the note away. Answers with the snapshot.
 */
export async function handleMemoSet(request, env, trip, ctx) {
  let body;
  try { body = await request.json(); } catch { return bad("Body must be JSON."); }
  const { name: who, error } = await ctx.actor(request, env, trip, "edit");
  if (error) return error;

  const { target } = body ?? {};
  if (typeof target !== "string" || !target) return bad("Say what the note is on.");
  const onDay = DAY.test(target) && (await ctx.getTrip(env, trip)).days.includes(target);
  if (!onDay && !(await ctx.isTarget(env, target, trip)))
    return bad("A note goes on a place, one of your own entries, or a day of this trip.");

  const text = cleanMemo(body?.text);
  if (text === undefined) return bad(`Keep the note under ${MAX_MEMO} characters.`);

  if (text === null)
    await env.DB.prepare("DELETE FROM memos WHERE trip_id = ?1 AND target = ?2").bind(trip, target).run();
  else
    await env.DB.prepare(
      `INSERT INTO memos (trip_id, target, text, set_by, set_by_key, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (trip_id, target) DO UPDATE SET
         text = excluded.text, set_by = excluded.set_by,
         set_by_key = excluded.set_by_key, updated_at = excluded.updated_at`
    ).bind(trip, target, text, who, ctx.voterKey(who), Date.now()).run();

  return json({ ok: true, ...(await ctx.snapshot(env, trip)) });
}

/** When the place or the entry goes, its note goes with it. */
export async function removeMemoFor(env, trip, target) {
  await env.DB.prepare("DELETE FROM memos WHERE trip_id = ?1 AND target = ?2").bind(trip, target).run();
}
