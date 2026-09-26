/**
 * Costs and money.
 *
 * An expense is what someone paid: a label, an amount in the trip's currency,
 * who paid, and who it was for. It is split equally among the people it was
 * for — everyone on the trip when nobody is named. From those, per person:
 * what they paid, what their share of everything is, and the balance between
 * the two. Settling up is the smallest set of payments that clears every
 * balance, worked out greedily: the biggest debtor pays the biggest creditor.
 *
 * Amounts are whole minor units (cents, pence). Splits are rounded to the
 * minor unit and the remainder goes to the first people in the list, so the
 * shares always add up to the amount and nobody is owed half a cent.
 *
 *   POST /api/t/<trip>/expense/add     { label, amount, paidBy?, forKeys?, day?, itemId? }
 *   POST /api/t/<trip>/expense/update  { id, ...same }
 *   POST /api/t/<trip>/expense/remove  { id }
 *
 * Editors and owners. `amount` may be a string like "12,50" or "12.50" or a
 * number of major units; it is stored as minor units.
 */

import { json, bad } from "./http.js";

export const CURRENCIES = ["EUR", "GBP", "USD", "CHF", "SEK", "NOK", "DKK", "CZK", "PLN", "HUF", "JPY", "AUD", "CAD"];
const NO_MINOR = new Set(["JPY", "HUF"]);

/** "12,50" | "12.50" | 12.5 → 1250. null when unusable. */
export function toMinor(raw, currency) {
  if (raw == null || raw === "") return null;
  let s = typeof raw === "number" ? String(raw) : String(raw).trim().replace(/\s/g, "");
  if (!/^[0-9]+([.,][0-9]{1,2})?$/.test(s)) return null;
  s = s.replace(",", ".");
  const [whole, frac = ""] = s.split(".");
  const minor = NO_MINOR.has(currency) ? Number(whole) : Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return Number.isFinite(minor) && minor > 0 && minor < 1e9 ? minor : null;
}

export async function getExpenses(env, trip) {
  const { results } = await env.DB.prepare(
    `SELECT id, label, amount, paid_by, for_keys, day, item_id, added_by, created_at
       FROM expenses WHERE trip_id = ?1 ORDER BY day ASC, created_at ASC`
  ).bind(trip).all();
  return (results ?? []).map((r) => {
    let forKeys = null;
    try { forKeys = r.for_keys ? JSON.parse(r.for_keys) : null; } catch { forKeys = null; }
    return { id: r.id, label: r.label, amount: r.amount, paidBy: r.paid_by, forKeys,
             day: r.day, itemId: r.item_id, addedBy: r.added_by, createdAt: r.created_at };
  });
}

/**
 * Per person: paid, share, balance (paid − share). `members` are the trip's
 * members ({ key, name }); anyone in an expense who is no longer a member
 * still gets a line, under their key, so the numbers stay honest.
 */
export function balances(expenses, members) {
  const people = new Map(members.map((m) => [m.key, { key: m.key, name: m.name, paid: 0, share: 0 }]));
  const ensure = (key) => people.get(key) ?? people.set(key, { key, name: key, paid: 0, share: 0 }).get(key);
  const everyone = members.map((m) => m.key);
  for (const x of expenses) {
    ensure(x.paidBy).paid += x.amount;
    const among = (x.forKeys && x.forKeys.length ? x.forKeys : everyone);
    if (!among.length) continue;
    const base = Math.floor(x.amount / among.length);
    let rest = x.amount - base * among.length;
    for (const k of among) { ensure(k).share += base + (rest > 0 ? 1 : 0); if (rest > 0) rest--; }
  }
  const rows = [...people.values()].map((p) => ({ ...p, balance: p.paid - p.share }));
  const total = expenses.reduce((n, x) => n + x.amount, 0);
  return { people: rows, total, settle: settleUp(rows) };
}

/** The smallest set of payments that clears every balance: { from, to, amount }[]. */
export function settleUp(rows) {
  const debtors = rows.filter((p) => p.balance < 0).map((p) => ({ key: p.key, left: -p.balance })).sort((a, b) => b.left - a.left);
  const creditors = rows.filter((p) => p.balance > 0).map((p) => ({ key: p.key, left: p.balance })).sort((a, b) => b.left - a.left);
  const out = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].left, creditors[j].left);
    if (amount > 0) out.push({ from: debtors[i].key, to: creditors[j].key, amount });
    debtors[i].left -= amount; creditors[j].left -= amount;
    if (debtors[i].left === 0) i++;
    if (creditors[j].left === 0) j++;
  }
  return out;
}

/** Validate and normalise an expense body against the trip. Returns { error } or the fields. */
async function readExpense(body, env, trip, ctx, me) {
  const label = ctx.cleanText(body?.label, 80);
  if (label === undefined) return { error: bad("Keep the label under 80 characters.") };
  if (!label) return { error: bad("What was it for?") };
  const info = await ctx.getTrip(env, trip);
  const amount = toMinor(body?.amount, info.currency);
  if (amount == null) return { error: bad("An amount like 12.50, greater than zero.") };

  const members = await ctx.getMembers(env, trip);
  const keys = new Set(members.map((m) => m.key));
  const paidBy = body?.paidBy == null || body.paidBy === "" ? me.key : ctx.voterKey(String(body.paidBy));
  if (!keys.has(paidBy)) return { error: bad("Who paid must be someone on the trip.") };

  let forKeys = null;
  if (Array.isArray(body?.forKeys) && body.forKeys.length) {
    forKeys = [...new Set(body.forKeys.map((k) => ctx.voterKey(String(k))))];
    if (forKeys.some((k) => !keys.has(k))) return { error: bad("Everyone it was for must be on the trip.") };
    if (forKeys.length === members.length) forKeys = null;   // "everyone" is the default, stored as nothing
  }

  const { day } = body ?? {};
  if (day != null && day !== "" && !info.days.includes(day)) return { error: bad("That date isn't a day of this trip.") };

  const itemId = typeof body?.itemId === "string" && body.itemId ? body.itemId : null;
  if (itemId && !(await ctx.isKnownSight(env, itemId, trip))) return { error: bad("Unknown place.") };

  return { label, amount, paidBy, forKeys, day: day || null, itemId };
}

export async function handleExpenseAdd(request, env, trip, ctx) {
  let body;
  try { body = await request.json(); } catch { return bad("Body must be JSON."); }
  const { member, name, error } = await ctx.actor(request, env, trip, "edit");
  if (error) return error;
  const x = await readExpense(body, env, trip, ctx, member);
  if (x.error) return x.error;
  const { count } = await env.DB.prepare("SELECT COUNT(*) AS count FROM expenses WHERE trip_id = ?1").bind(trip).first();
  if (count >= 500) return bad("Five hundred expenses is plenty for one trip.");
  await env.DB.prepare(
    `INSERT INTO expenses (id, trip_id, label, amount, paid_by, for_keys, day, item_id, added_by, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  ).bind(`x-${crypto.randomUUID()}`, trip, x.label, x.amount, x.paidBy, x.forKeys ? JSON.stringify(x.forKeys) : null,
         x.day, x.itemId, name, Date.now()).run();
  return json({ ok: true, ...(await ctx.snapshot(env, trip)) });
}

export async function handleExpenseUpdate(request, env, trip, ctx) {
  let body;
  try { body = await request.json(); } catch { return bad("Body must be JSON."); }
  const { member, error } = await ctx.actor(request, env, trip, "edit");
  if (error) return error;
  const { id } = body ?? {};
  if (typeof id !== "string" || !id.startsWith("x-")) return bad("Unknown expense.");
  const row = await env.DB.prepare("SELECT 1 FROM expenses WHERE id = ?1 AND trip_id = ?2").bind(id, trip).first();
  if (!row) return bad("That expense is already gone.", 404);
  const x = await readExpense(body, env, trip, ctx, member);
  if (x.error) return x.error;
  await env.DB.prepare(
    `UPDATE expenses SET label = ?1, amount = ?2, paid_by = ?3, for_keys = ?4, day = ?5, item_id = ?6
      WHERE id = ?7 AND trip_id = ?8`
  ).bind(x.label, x.amount, x.paidBy, x.forKeys ? JSON.stringify(x.forKeys) : null, x.day, x.itemId, id, trip).run();
  return json({ ok: true, ...(await ctx.snapshot(env, trip)) });
}

export async function handleExpenseRemove(request, env, trip, ctx) {
  let body;
  try { body = await request.json(); } catch { return bad("Body must be JSON."); }
  const { error } = await ctx.actor(request, env, trip, "edit");
  if (error) return error;
  const { id } = body ?? {};
  if (typeof id !== "string") return bad("Unknown expense.");
  await env.DB.prepare("DELETE FROM expenses WHERE id = ?1 AND trip_id = ?2").bind(id, trip).run();
  return json({ ok: true, ...(await ctx.snapshot(env, trip)) });
}
