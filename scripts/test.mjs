import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/worker.js";

const db = new DatabaseSync(":memory:");
const sql = readFileSync(new URL("../schema.sql", import.meta.url), "utf8")
  .replace(/--[^\n]*/g, "");
for (const stmt of sql.split(";")) if (stmt.trim()) db.exec(stmt + ";");
// Minimal D1 shim over node:sqlite
const DB = {
  prepare(sql) {
    const s = sql.replace(/\?(\d+)/g, "?");
    let args = [];
    return {
      bind(...a) { args = a; return this; },
      async run() { db.prepare(s).run(...args); return { success: true }; },
      async all() { return { results: db.prepare(s).all(...args) }; },
      async first(col) {
        const row = db.prepare(s).get(...args);
        if (row === undefined) return null;
        return col ? row[col] : row;
      },
    };
  },
};
const env = { DB, ASSETS: { fetch: () => new Response("static", { status: 200 }) } };
const call = (path, init) => worker.fetch(new Request("https://x" + path, init), env);
const post = (body) => call("/api/vote", { method: "POST", body: JSON.stringify(body) });

let ok = 0, fail = 0;
const t = (name, cond) => { cond ? (ok++, console.log("  ✓", name)) : (fail++, console.log("  ✗", name)); };

const list = await (await call("/api/sights")).json();
t("GET /api/sights returns the full list", list.sights.length === 55);
t("every sight has a url", list.sights.every(s => s.url?.startsWith("http")));
t("every sight has a wiki title", list.sights.every(s => s.wiki));
t("votes start empty", Object.keys(list.votes).length === 0);

let r = await (await post({ sightId: "tower-of-london", voter: "Manuel", wanted: true })).json();
t("vote saved", r.votes["tower-of-london"]?.[0] === "Manuel");

r = await (await post({ sightId: "tower-of-london", voter: "Anna", wanted: true })).json();
t("second voter appends", r.votes["tower-of-london"].length === 2);

r = await (await post({ sightId: "tower-of-london", voter: "  manuel ", wanted: true })).json();
t("same person twice is idempotent", r.votes["tower-of-london"].length === 2);

r = await (await post({ sightId: "tower-of-london", voter: "Manuel", wanted: false })).json();
t("un-vote removes only that person", r.votes["tower-of-london"].length === 1 && r.votes["tower-of-london"][0] === "Anna");

let res = await post({ sightId: "not-a-real-place", voter: "Manuel", wanted: true });
t("unknown sight rejected (400)", res.status === 400);

res = await post({ sightId: "sky-garden", voter: "   ", wanted: true });
t("blank name rejected (400)", res.status === 400);

res = await post({ sightId: "sky-garden", voter: "x".repeat(40), wanted: true });
t("over-long name rejected (400)", res.status === 400);

res = await post({ sightId: "sky-garden", voter: "Manuel", wanted: "yes" });
t("non-boolean `wanted` rejected (400)", res.status === 400);

res = await call("/api/vote", { method: "POST", body: "not json" });
t("malformed body rejected (400)", res.status === 400);

res = await call("/api/nope");
t("unknown api route 404s", res.status === 404);

res = await call("/index.html");
t("non-api path falls through to ASSETS", (await res.text()) === "static");

// access code
const guarded = { ...env, ACCESS_CODE: "s3cret" };
res = await worker.fetch(new Request("https://x/api/state"), guarded);
t("ACCESS_CODE blocks without header (401)", res.status === 401);
res = await worker.fetch(new Request("https://x/api/state", { headers: { "x-access-code": "s3cret" } }), guarded);
t("ACCESS_CODE allows with header", res.status === 200);


/* ---------------- new endpoints ---------------- */
console.log("\ncustom sights:");
const add = (b) => call("/api/sights/add", { method: "POST", body: JSON.stringify(b) });
const del = (b) => call("/api/sights/remove", { method: "POST", body: JSON.stringify(b) });
let ok2 = 0, fail2 = 0;
const t2 = (n, c) => { c ? (ok2++, console.log("  ✓", n)) : (fail2++, console.log("  ✗", n)); };

const s2 = await (await call("/api/sights")).json();
t2("list now has 55 built-in sights", s2.sights.length === 55);
t2("London Eye is present", s2.sights.some(x => x.id === "london-eye"));
t2("Bridgerton house is present", s2.sights.some(x => x.id === "rangers-house-bridgerton"));
t2("free Potter stops present", ["platform-9-3-4","house-of-minalima","millennium-bridge","st-pancras-international"].every(id => s2.sights.some(x => x.id === id)));
t2("British Museum present", s2.sights.some(x => x.id === "british-museum"));
t2("every sight has German text", s2.sights.every(x => x.name_de && x.summary_de));
t2("ranks are 1..55 with no gaps", s2.sights.map(x=>x.rank).join() === Array.from({length:55},(_,i)=>i+1).join());

let a = await (await add({ voter: "Manuel", name: "Sky Pod Bar", url: "skygarden.london", summary: "Drinks up top" })).json();
t2("custom sight created", a.custom.length === 1 && a.custom[0].name === "Sky Pod Bar");
t2("bare domain gets https://", a.custom[0].url === "https://skygarden.london/");
t2("creator auto-votes", a.votes[a.custom[0].id]?.[0] === "Manuel");
const customId = a.custom[0].id;

let r2 = await (await post({ sightId: customId, voter: "Anna", wanted: true })).json();
t2("others can vote on a custom sight", r2.votes[customId].length === 2);

let res2 = await add({ voter: "Anna", name: "sky pod BAR" });
t2("duplicate name rejected", res2.status === 400);

res2 = await add({ voter: "Anna", name: "Bad link", url: "javascript:alert(1)" });
t2("javascript: URL rejected", res2.status === 400);

res2 = await add({ voter: "Anna", name: "" });
t2("empty name rejected", res2.status === 400);

res2 = await add({ voter: "", name: "No voter" });
t2("missing voter rejected", res2.status === 400);

res2 = await add({ voter: "Anna", name: "Long", summary: "x".repeat(400) });
t2("over-long description rejected", res2.status === 400);

a = await (await add({ voter: "Anna", name: "Just a name" })).json();
t2("link and description are optional", a.custom.length === 2);
const annaId = a.custom.find(c => c.name === "Just a name").id;
t2("optional fields are null", a.custom.find(c => c.id === annaId).url === null);

res2 = await del({ id: customId, voter: "Anna" });
t2("non-creator cannot remove (403)", res2.status === 403);

let d2 = await (await del({ id: customId, voter: "manuel" })).json();
t2("creator can remove", !d2.custom.some(c => c.id === customId));
t2("removing also clears its votes", !d2.votes[customId]);

res2 = await del({ id: "tower-of-london", voter: "Manuel" });
t2("built-in sights cannot be removed", res2.status === 400);

res2 = await post({ sightId: "custom-does-not-exist", voter: "Manuel", wanted: true });
t2("voting on a missing custom id rejected", res2.status === 400);


/* ---------------- comments ---------------- */
console.log("\ncomments:");
const cadd = (b) => call("/api/comments/add", { method: "POST", body: JSON.stringify(b) });
const cdel = (b) => call("/api/comments/remove", { method: "POST", body: JSON.stringify(b) });

let c = await (await cadd({ voter: "Manuel", sightId: "tower-of-london", body: "Ravens!" })).json();
t2("comment saved", c.comments["tower-of-london"]?.[0]?.body === "Ravens!");
t2("comment records the author", c.comments["tower-of-london"][0].author === "Manuel");
const cid = c.comments["tower-of-london"][0].id;

c = await (await cadd({ voter: "Anna", sightId: "tower-of-london", body: "Book early" })).json();
t2("second comment appends in order", c.comments["tower-of-london"].map(x => x.body).join("|") === "Ravens!|Book early");

let cr = await cadd({ voter: "Manuel", sightId: "tower-of-london", body: "   " });
t2("empty comment rejected", cr.status === 400);

cr = await cadd({ voter: "Manuel", sightId: "tower-of-london", body: "x".repeat(600) });
t2("over-long comment rejected", cr.status === 400);

cr = await cadd({ voter: "", sightId: "tower-of-london", body: "anon" });
t2("comment without a name rejected", cr.status === 400);

cr = await cadd({ voter: "Manuel", sightId: "nope", body: "hi" });
t2("comment on unknown sight rejected", cr.status === 400);

cr = await cdel({ id: cid, voter: "Anna" });
t2("non-author cannot delete a comment (403)", cr.status === 403);

c = await (await cdel({ id: cid, voter: "MANUEL" })).json();
t2("author can delete their comment", c.comments["tower-of-london"].length === 1);

// comments on a custom sight die with it
let ca = await (await add({ voter: "Manuel", name: "Temp place" })).json();
const tempId = ca.custom.find(x => x.name === "Temp place").id;
await cadd({ voter: "Anna", sightId: tempId, body: "on a custom one" });
let cd = await (await del({ id: tempId, voter: "Manuel" })).json();
t2("removing a custom sight removes its comments", !cd.comments[tempId]);

const snap = await (await call("/api/state")).json();
t2("/api/state returns votes, custom and comments",
   !!snap.votes && Array.isArray(snap.custom) && !!snap.comments);

/* ---------------------------------------------------------- bookings list */

console.log("\nbookings list");
let ok3 = 0, fail3 = 0;
const t3 = (name, cond) => { cond ? (ok3++, console.log("  ✓", name)) : (fail3++, console.log("  ✗", name)); };

const setStatus = (b) => call("/api/bookings/status", { method: "POST", body: JSON.stringify(b) });
const hide = (b) => setStatus({ ...b, status: "skipped" });
const show = (b) => setStatus({ ...b, status: null });
const stateOf = (snap, id) => snap.bookings.find(x => x.id === id)?.status ?? "todo";

// The rule the page applies: costs money, or has to be booked ahead.
const costsMoney = (s) => (s.custom ? !!s.costs : s.cost !== "free");
const onList = (s) => costsMoney(s) || !!s.bookingRequired;

t3("some built-in sights belong on the list", list.sights.filter(onList).length > 0);
t3("not all of them do", list.sights.filter(onList).length < list.sights.length);
t3("free sights that must be booked are still included",
   list.sights.some(s => s.cost === "free" && s.bookingRequired && onList(s)));
t3("every priced sight has a price label",
   list.sights.filter(s => s.cost === "paid").every(s => s.priceLabel));

// --- adding a sight now records whether it costs anything
let added = await (await add({ voter: "Emily", name: "Paid thing",
  costs: true, priceLabel: "£36 pp", bookingRequired: true })).json();
const paid = added.custom.find(c => c.name === "Paid thing");
t3("an added sight can be marked as costing money", paid.costs === true);
t3("its price is kept", paid.priceLabel === "£36 pp");
t3("its booking flag is kept", paid.bookingRequired === true);
t3("and it lands on the list", onList(paid));

added = await (await add({ voter: "Emily", name: "Free thing" })).json();
const free = added.custom.find(c => c.name === "Free thing");
t3("an added sight defaults to costing nothing", free.costs === false);
t3("and stays off the list", !onList(free));
t3("a price over 40 characters is rejected",
   (await add({ voter: "Emily", name: "Long price", costs: true,
                priceLabel: "x".repeat(41) })).status === 400);

// --- hiding takes it off the list only
await post({ voter: "Maya", sightId: paid.id, wanted: true });
let h = await (await hide({ voter: "Emily", sightId: paid.id })).json();
t3("a sight can be taken off the booking list", stateOf(h, paid.id) === "skipped");
t3("who removed it is recorded",
   h.bookings.find(x => x.id === paid.id)?.by === "Emily");
t3("it stays in the sight list", h.custom.some(c => c.id === paid.id));
t3("it keeps its votes", (h.votes[paid.id] ?? []).includes("Maya"));

h = await (await show({ voter: "Emily", sightId: paid.id })).json();
t3("and it can be put back", stateOf(h, paid.id) === "todo");

h = await (await hide({ voter: "Maya", sightId: "london-eye" })).json();
t3("built-in sights can be hidden too", stateOf(h, "london-eye") === "skipped");
t3("marking twice does not duplicate the row",
   (await (await hide({ voter: "Emily", sightId: "london-eye" })).json())
     .bookings.filter(x => x.id === "london-eye").length === 1);
t3("the most recent person is the one recorded",
   (await (await call("/api/state")).json()).bookings
     .find(x => x.id === "london-eye")?.by === "Emily");

// --- booked moves it to its own list
let b = await (await setStatus({ voter: "Maya", sightId: paid.id, status: "booked" })).json();
t3("a sight can be marked as booked", stateOf(b, paid.id) === "booked");
t3("who booked it is recorded", b.bookings.find(x => x.id === paid.id)?.by === "Maya");
t3("when it was booked is recorded",
   typeof b.bookings.find(x => x.id === paid.id)?.at === "number");
t3("booking it keeps it in the sight list", b.custom.some(c => c.id === paid.id));
t3("booking it keeps its votes", (b.votes[paid.id] ?? []).includes("Maya"));

b = await (await setStatus({ voter: "Maya", sightId: paid.id, status: "skipped" })).json();
t3("booked and skipped are the same slot, so it cannot be both",
   b.bookings.filter(x => x.id === paid.id).length === 1 &&
   stateOf(b, paid.id) === "skipped");

b = await (await setStatus({ voter: "Maya", sightId: paid.id, status: null })).json();
t3("null returns it to the list still to book", stateOf(b, paid.id) === "todo");

// --- the slot we actually hold
let sl = await (await setStatus({ voter: "Maya", sightId: "tower-of-london",
  status: "booked", bookedDate: "2026-09-14", bookedTime: "14:30" })).json();
const slot = sl.bookings.find(x => x.id === "tower-of-london");
t3("a booking can record its date", slot?.date === "2026-09-14");
t3("and its time", slot?.time === "14:30");

sl = await (await setStatus({ voter: "Maya", sightId: "tower-of-london",
  status: "booked", bookedDate: "2026-09-15" })).json();
const noTime = sl.bookings.find(x => x.id === "tower-of-london");
t3("a date without a time is fine", noTime?.date === "2026-09-15" && noTime?.time === null);

sl = await (await setStatus({ voter: "Maya", sightId: "tower-of-london", status: "booked" })).json();
t3("re-saving without a slot clears the old one",
   sl.bookings.find(x => x.id === "tower-of-london")?.date === null);

t3("a malformed date is rejected",
   (await setStatus({ voter: "M", sightId: "tower-of-london", status: "booked",
                      bookedDate: "14/09/2026" })).status === 400);
t3("a malformed time is rejected",
   (await setStatus({ voter: "M", sightId: "tower-of-london", status: "booked",
                      bookedDate: "2026-09-14", bookedTime: "25:99" })).status === 400);
t3("a time with no date is rejected",
   (await setStatus({ voter: "M", sightId: "tower-of-london", status: "booked",
                      bookedTime: "14:30" })).status === 400);
t3("a slot on something we are not booking is rejected",
   (await setStatus({ voter: "M", sightId: "tower-of-london", status: "skipped",
                      bookedDate: "2026-09-14" })).status === 400);
{
  await setStatus({ voter: "M", sightId: "tower-of-london", status: "booked",
                    bookedDate: "2026-09-14", bookedTime: "14:30" });
  const back = await (await setStatus({ voter: "M", sightId: "tower-of-london", status: null })).json();
  t3("un-booking removes the row entirely",
     !back.bookings.some(x => x.id === "tower-of-london"));
}

t3("an invalid status is rejected",
   (await setStatus({ voter: "Emily", sightId: paid.id, status: "maybe" })).status === 400);
t3("a missing status is rejected",
   (await setStatus({ voter: "Emily", sightId: paid.id })).status === 400);

t3("hiding needs a name", (await hide({ voter: "", sightId: "london-eye" })).status === 400);
t3("hiding an unknown sight is rejected",
   (await hide({ voter: "Emily", sightId: "nope" })).status === 400);
t3("showing an unknown sight is rejected",
   (await show({ voter: "Emily", sightId: "nope" })).status === 400);

// --- deleting a custom sight cleans up after itself
const doomed = (await (await add({ voter: "Emily", name: "Doomed", costs: true })).json())
  .custom.find(c => c.name === "Doomed");
await hide({ voter: "Emily", sightId: doomed.id });
const after = await (await del({ id: doomed.id, voter: "Emily" })).json();
t3("removing a custom sight clears its booking row",
   !after.bookings.some(x => x.id === doomed.id));

t3("/api/state carries the booking states",
   Array.isArray((await (await call("/api/state")).json()).bookings));

console.log(`\n${ok + ok2 + ok3} passed, ${fail + fail2 + fail3} failed`);
process.exit(fail + fail2 + fail3 ? 1 : 0);
