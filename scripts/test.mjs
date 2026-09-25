import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/worker.js";

import { splitStatements } from "./sql-split.mjs";

const db = new DatabaseSync(":memory:");
// A fresh database, plus the London places the way `npm run migrate` would
// import them — so the tests see the same trip 1 the live database has.
for (const file of ["../schema.sql", "./migrate-009-london-items.sql"])
  for (const stmt of splitStatements(readFileSync(new URL(file, import.meta.url), "utf8")))
    db.exec(stmt + ";");
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
// The assets mock answers with the path it was asked for, so a test can see
// which file the Worker chose to serve.
const env = { DB, ASSETS: { fetch: (req) => new Response("static " + new URL(req.url).pathname, { status: 200 }) } };
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
t("non-api path falls through to ASSETS", (await res.text()).startsWith("static"));

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

// --- cost and booking can be fixed after the fact
const edit = (b) => call("/api/sights/edit", { method: "POST", body: JSON.stringify(b) });

const plain = (await (await add({ voter: "Maya", name: "A tour" })).json())
  .custom.find(c => c.name === "A tour");
t3("an added sight starts free and unbooked",
   plain.costs === false && plain.bookingRequired === false);
t3("so it is off the bookings list", !onList(plain));

let ed = await (await edit({ voter: "Emily", id: plain.id, costs: true,
  priceLabel: "£18 pp", bookingRequired: true })).json();
let fixed = ed.custom.find(c => c.id === plain.id);
t3("anyone can mark it as costing money, not just whoever added it",
   fixed.costs === true);
t3("the price is stored", fixed.priceLabel === "£18 pp");
t3("the booking flag is stored", fixed.bookingRequired === true);
t3("and it lands on the bookings list", onList(fixed));

ed = await (await edit({ voter: "Emily", id: plain.id, costs: false,
  bookingRequired: true })).json();
fixed = ed.custom.find(c => c.id === plain.id);
t3("free but needing booking still counts", onList(fixed));
t3("clearing the cost clears the price too", fixed.priceLabel === null);

ed = await (await edit({ voter: "Emily", id: plain.id, costs: false,
  bookingRequired: false })).json();
t3("and it can be taken back off the list",
   !onList(ed.custom.find(c => c.id === plain.id)));

await post({ voter: "Maya", sightId: plain.id, wanted: true });
ed = await (await edit({ voter: "Emily", id: plain.id, costs: true,
  bookingRequired: false })).json();
t3("editing leaves the votes alone", (ed.votes[plain.id] ?? []).includes("Maya"));

t3("built-in sights cannot be edited this way",
   (await edit({ voter: "E", id: "tower-of-london", costs: true, bookingRequired: false })).status === 400);
t3("the flags are required",
   (await edit({ voter: "E", id: plain.id })).status === 400);
t3("a non-boolean flag is rejected",
   (await edit({ voter: "E", id: plain.id, costs: "yes", bookingRequired: false })).status === 400);
t3("editing needs a name",
   (await edit({ voter: "", id: plain.id, costs: true, bookingRequired: false })).status === 400);
t3("editing something gone gives a 404",
   (await edit({ voter: "E", id: "custom-nope", costs: true, bookingRequired: false })).status === 404);
t3("an over-long price is rejected",
   (await edit({ voter: "E", id: plain.id, costs: true, bookingRequired: false,
                 priceLabel: "x".repeat(41) })).status === 400);

// --- an address, so an added sight can be routed to
const setAddr = (b) => call("/api/sights/address", { method: "POST", body: JSON.stringify(b) });
const geo = (b) => call("/api/geocode", { method: "POST", body: JSON.stringify(b) });

const noAddr = (await (await add({ voter: "Maya", name: "A walking tour" })).json())
  .custom.find(c => c.name === "A walking tour");
t3("an added sight starts with no location",
   noAddr.lat === null && noAddr.lon === null);

let ad = await (await setAddr({ voter: "Emily", id: noAddr.id,
  address: "Tower Hill, London", lat: 51.5098, lon: -0.0767 })).json();
let located = ad.custom.find(c => c.id === noAddr.id);
t3("an address can be added afterwards", located.lat === 51.5098 && located.lon === -0.0767);
t3("the address text is kept", located.address === "Tower Hill, London");
t3("anyone can add it, not only whoever added the sight", located.lat !== null);

ad = await (await setAddr({ voter: "Emily", id: noAddr.id,
  address: null, lat: null, lon: null })).json();
located = ad.custom.find(c => c.id === noAddr.id);
t3("and it can be cleared again",
   located.lat === null && located.lon === null && located.address === null);

t3("built-in sights are refused",
   (await setAddr({ voter: "E", id: "tower-of-london", lat: 51.5, lon: -0.1 })).status === 400);
t3("half a coordinate is refused",
   (await setAddr({ voter: "E", id: noAddr.id, lat: 51.5 })).status === 400);
t3("an impossible latitude is refused",
   (await setAddr({ voter: "E", id: noAddr.id, lat: 999, lon: 0 })).status === 400);
t3("an over-long address is refused",
   (await setAddr({ voter: "E", id: noAddr.id, address: "x".repeat(201),
                    lat: 51.5, lon: -0.1 })).status === 400);
t3("setting an address needs a name",
   (await setAddr({ voter: "", id: noAddr.id, lat: 51.5, lon: -0.1 })).status === 400);
t3("a sight that is gone gives a 404",
   (await setAddr({ voter: "E", id: "custom-nope", lat: 51.5, lon: -0.1 })).status === 404);

// The lookup: link and coordinate parsing is offline, so it is safe to assert.
const pasted = await (await geo({ voter: "M",
  q: "https://www.google.com/maps/place/X/@51.1,-0.1,17z/data=!4m6!3m5!8m2!3d51.4994!4d-0.1632" })).json();
t3("a pasted Google link resolves without a search",
   pasted.results[0].lat === 51.4994 && pasted.results[0].from === "google");
const coords = await (await geo({ voter: "M", q: "51.5074, -0.1278" })).json();
t3("raw coordinates are accepted", coords.results[0].lon === -0.1278);
t3("an empty search is refused", (await geo({ voter: "M", q: "" })).status === 400);
t3("looking up needs a name", (await geo({ voter: "", q: "Harrods" })).status === 400);

// --- what it is all for: the sight now appears in a day's route
{
  const { routeLinks } = await import("../public/route.js");
  await setAddr({ voter: "E", id: noAddr.id, address: "Tower Hill",
                  lat: 51.5098, lon: -0.0767 });
  const snap = await (await call("/api/sights")).json();
  const get = (id) => snap.sights.find(x => x.id === id) ?? snap.custom.find(x => x.id === id);
  const withAddr = routeLinks([get("tower-of-london"), get(noAddr.id), get("tate-modern")]);
  t3("an added sight with an address joins the route",
     withAddr.used === 3 && withAddr.skipped === 0);

  await setAddr({ voter: "E", id: noAddr.id, address: null, lat: null, lon: null });
  const snap2 = await (await call("/api/sights")).json();
  const get2 = (id) => snap2.sights.find(x => x.id === id) ?? snap2.custom.find(x => x.id === id);
  const without = routeLinks([get2("tower-of-london"), get2(noAddr.id), get2("tate-modern")]);
  t3("and drops out of it when the address is removed",
     without.used === 2 && without.skipped === 1);
}

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

/* ----------------------------------------------------------------- the plan */

console.log("\nplan");
let ok4 = 0, fail4 = 0;
const t4 = (name, cond) => { cond ? (ok4++, console.log("  ✓", name)) : (fail4++, console.log("  ✗", name)); };

const planSet = (b) => call("/api/plan/set", { method: "POST", body: JSON.stringify(b) });
const planRm = (b) => call("/api/plan/remove", { method: "POST", body: JSON.stringify(b) });
const onPlan = (d, id) => d.plan.some(e => e.id === id);
const bookedOn = (d, id) => d.bookings.some(x => x.id === id && x.status === "booked" && x.date);

const trip = (await (await call("/api/sights")).json()).trip;
t4("the API hands over the trip days", trip.days.length === 6);
t4("they are the days of the trip", trip.days[0] === "2026-09-11" && trip.days[5] === "2026-09-16");

let pl = await (await planSet({ voter: "Emily", sightId: "british-museum",
  day: "2026-09-15", start: "10:00", end: "12:30" })).json();
t4("a sight can be put on the plan by hand", onPlan(pl, "british-museum"));
const entry = pl.plan.find(e => e.id === "british-museum");
t4("its day is kept", entry.day === "2026-09-15");
t4("its start and end are kept", entry.start === "10:00" && entry.end === "12:30");
t4("who added it is kept", entry.addedBy === "Emily");

pl = await (await planSet({ voter: "Emily", sightId: "trafalgar-square", day: "2026-09-15" })).json();
const bare = pl.plan.find(e => e.id === "trafalgar-square");
t4("a day on its own is enough", bare.day === "2026-09-15" && bare.start === null);

pl = await (await planSet({ voter: "Emily", sightId: "trafalgar-square",
  day: "2026-09-12", start: "09:00" })).json();
t4("setting it again moves it rather than duplicating",
   pl.plan.filter(e => e.id === "trafalgar-square").length === 1 &&
   pl.plan.find(e => e.id === "trafalgar-square").day === "2026-09-12");

// booking is the other source, and it wins
pl = await (await setStatus({ voter: "Maya", sightId: "british-museum",
  status: "booked", bookedDate: "2026-09-13", bookedTime: "11:00", bookedEnd: "13:00" })).json();
t4("booking a hand-placed sight removes the hand entry", !onPlan(pl, "british-museum"));
t4("and it is on the plan from its booking", bookedOn(pl, "british-museum"));
t4("the booked end time is kept",
   pl.bookings.find(x => x.id === "british-museum")?.endTime === "13:00");
t4("a hand entry for something already booked is refused",
   (await planSet({ voter: "Emily", sightId: "british-museum", day: "2026-09-12" })).status === 400);

pl = await (await setStatus({ voter: "Maya", sightId: "british-museum", status: null })).json();
t4("un-booking takes it off the plan entirely",
   !onPlan(pl, "british-museum") && !bookedOn(pl, "british-museum"));

t4("a booked end before its start is rejected",
   (await setStatus({ voter: "M", sightId: "london-eye", status: "booked",
                      bookedDate: "2026-09-12", bookedTime: "14:00", bookedEnd: "10:00" })).status === 400);
t4("a booked end with no start is rejected",
   (await setStatus({ voter: "M", sightId: "london-eye", status: "booked",
                      bookedDate: "2026-09-12", bookedEnd: "10:00" })).status === 400);
t4("a booked date outside the trip is rejected",
   (await setStatus({ voter: "M", sightId: "london-eye", status: "booked",
                      bookedDate: "2026-12-01" })).status === 400);

t4("a day outside the trip is rejected",
   (await planSet({ voter: "E", sightId: "tate-modern", day: "2026-12-01" })).status === 400);
t4("an end before the start is rejected",
   (await planSet({ voter: "E", sightId: "tate-modern", day: "2026-09-12",
                    start: "14:00", end: "10:00" })).status === 400);
t4("an end with no start is rejected",
   (await planSet({ voter: "E", sightId: "tate-modern", day: "2026-09-12", end: "10:00" })).status === 400);
t4("a malformed time is rejected",
   (await planSet({ voter: "E", sightId: "tate-modern", day: "2026-09-12", start: "25:99" })).status === 400);
t4("planning needs a name",
   (await planSet({ voter: "", sightId: "tate-modern", day: "2026-09-12" })).status === 400);
t4("planning an unknown sight is rejected",
   (await planSet({ voter: "E", sightId: "nope", day: "2026-09-12" })).status === 400);

pl = await (await planRm({ voter: "Emily", sightId: "trafalgar-square" })).json();
t4("a hand entry can be taken off", !onPlan(pl, "trafalgar-square"));
t4("removing one that isn't there is harmless",
   (await planRm({ voter: "Emily", sightId: "trafalgar-square" })).status === 200);

// a deleted custom sight must not linger on the plan
const ghost = (await (await add({ voter: "Emily", name: "Ghost stop" })).json())
  .custom.find(c => c.name === "Ghost stop");
await planSet({ voter: "Emily", sightId: ghost.id, day: "2026-09-12" });
const gone = await (await del({ id: ghost.id, voter: "Emily" })).json();
t4("deleting a custom sight takes it off the plan", !onPlan(gone, ghost.id));

t4("/api/state carries the plan", Array.isArray((await (await call("/api/state")).json()).plan));

// --- your own entries: things that aren't sights at all
const noteAdd = (b) => call("/api/plan/note/add", { method: "POST", body: JSON.stringify(b) });
const noteRm = (b) => call("/api/plan/note/remove", { method: "POST", body: JSON.stringify(b) });

let nt = await (await noteAdd({ voter: "Emily", label: "Musical",
  day: "2026-09-11", start: "17:00", end: "21:00" })).json();
const note = nt.notes.find(n => n.label === "Musical");
t4("an entry of your own can be added", !!note);
t4("its day is kept", note.day === "2026-09-11");
t4("its times are kept", note.start === "17:00" && note.end === "21:00");
t4("who added it is kept", note.addedBy === "Emily");
t4("it gets its own id, not a sight's", note.id.startsWith("note-"));

nt = await (await noteAdd({ voter: "Maya", label: "Train home", day: "2026-09-16" })).json();
t4("a day on its own is enough",
   nt.notes.find(n => n.label === "Train home")?.start === null);
t4("two entries can share a day and a label is not unique",
   (await (await noteAdd({ voter: "Maya", label: "Musical", day: "2026-09-14" })).json())
     .notes.filter(n => n.label === "Musical").length === 2);

t4("a label is required", (await noteAdd({ voter: "E", day: "2026-09-11" })).status === 400);
{
  const long = await noteAdd({ voter: "E", label: "x".repeat(81), day: "2026-09-11" });
  t4("an over-long label is rejected", long.status === 400);
  // cleanText returns undefined for too-long and null for empty, and
  // `!undefined` is true — so the length check has to come first or this
  // message is unreachable.
  t4("and says it is too long, not that it is missing",
     /80 characters/.test((await long.json()).error));
}
t4("a day outside the trip is rejected",
   (await noteAdd({ voter: "E", label: "x", day: "2026-12-01" })).status === 400);
t4("an end before the start is rejected",
   (await noteAdd({ voter: "E", label: "x", day: "2026-09-11", start: "20:00", end: "10:00" })).status === 400);
t4("an end with no start is rejected",
   (await noteAdd({ voter: "E", label: "x", day: "2026-09-11", end: "10:00" })).status === 400);
t4("adding one needs a name",
   (await noteAdd({ voter: "", label: "x", day: "2026-09-11" })).status === 400);

// A place can come in with the entry, so the add form doesn't have to be
// followed by a second trip through the address form.
{
  const placed = (await (await noteAdd({ voter: "Emily", label: "Friends at a cafe",
    day: "2026-09-12", address: "Monmouth Coffee, Borough", lat: 51.5053, lon: -0.0913 })).json())
    .notes.find(n => n.label === "Friends at a cafe");
  t4("an entry can be added with a location already on it",
     placed.address === "Monmouth Coffee, Borough" &&
     placed.lat === 51.5053 && placed.lon === -0.0913);

  const typed = (await (await noteAdd({ voter: "Emily", label: "Somewhere vague",
    day: "2026-09-12", address: "a place I have not looked up" })).json())
    .notes.find(n => n.label === "Somewhere vague");
  t4("address text with no coordinates is kept, not dropped",
     typed.address === "a place I have not looked up");
  t4("and it stays unroutable rather than landing on the equator",
     typed.lat === null && typed.lon === null);

  t4("half a coordinate on a new entry is rejected",
     (await noteAdd({ voter: "E", label: "x", day: "2026-09-12", lat: 51.5 })).status === 400);
  t4("an impossible coordinate on a new entry is rejected",
     (await noteAdd({ voter: "E", label: "x", day: "2026-09-12", lat: 999, lon: 0 })).status === 400);
  t4("an over-long address on a new entry is rejected",
     (await noteAdd({ voter: "E", label: "x", day: "2026-09-12",
                      address: "y".repeat(201) })).status === 400);
}

nt = await (await noteRm({ voter: "Emily", id: note.id })).json();
t4("an entry can be removed", !nt.notes.some(n => n.id === note.id));
t4("anyone can remove one, not just whoever added it",
   !(await (await noteRm({ voter: "Maya", id: nt.notes[0].id })).json())
     .notes.some(n => n.id === nt.notes[0].id));
t4("a sight id is not accepted as an entry id",
   (await noteRm({ voter: "E", id: "tower-of-london" })).status === 400);
t4("removing one needs a name",
   (await noteRm({ voter: "", id: "note-whatever" })).status === 400);

// --- your own entries can be routed to as well
const noteAddr = (b) => call("/api/plan/note/address", { method: "POST", body: JSON.stringify(b) });

const dinner = (await (await noteAdd({ voter: "Emily", label: "Dinner with Anna",
  day: "2026-09-13", start: "19:00", end: "21:00" })).json())
  .notes.find(n => n.label === "Dinner with Anna");
t4("an entry of your own starts with no location",
   dinner.lat === null && dinner.lon === null);

let da = await (await noteAddr({ voter: "Maya", id: dinner.id,
  address: "Dishoom Shoreditch", lat: 51.5246, lon: -0.0777 })).json();
let placedNote = da.notes.find(n => n.id === dinner.id);
t4("it can be given one", placedNote.lat === 51.5246 && placedNote.lon === -0.0777);
t4("the address text is kept", placedNote.address === "Dishoom Shoreditch");
t4("anyone can set it, not only whoever added the entry", placedNote.lat !== null);

{
  const { routeLinks } = await import("../public/route.js");
  const snap = await (await call("/api/sights")).json();
  const tower = snap.sights.find(s => s.id === "tower-of-london");
  const withDinner = routeLinks([tower, snap.notes.find(n => n.id === dinner.id)]);
  t4("and then joins a day's route", withDinner.used === 2 && withDinner.skipped === 0);
}

da = await (await noteAddr({ voter: "Maya", id: dinner.id,
  address: null, lat: null, lon: null })).json();
placedNote = da.notes.find(n => n.id === dinner.id);
t4("clearing it removes address and coordinates together",
   placedNote.lat === null && placedNote.lon === null && placedNote.address === null);

{
  const { routeLinks } = await import("../public/route.js");
  const snap = await (await call("/api/sights")).json();
  const tower = snap.sights.find(s => s.id === "tower-of-london");
  const without = routeLinks([tower, snap.notes.find(n => n.id === dinner.id)]);
  t4("and it drops back out of the route", without.used === 1 && without.skipped === 1);
}

t4("a sight id is refused by the entry endpoint",
   (await noteAddr({ voter: "E", id: "custom-x", lat: 51.5, lon: -0.1 })).status === 400);
t4("half a coordinate is refused",
   (await noteAddr({ voter: "E", id: dinner.id, lat: 51.5 })).status === 400);
t4("an impossible longitude is refused",
   (await noteAddr({ voter: "E", id: dinner.id, lat: 51.5, lon: 999 })).status === 400);
t4("an entry that is gone gives a 404",
   (await noteAddr({ voter: "E", id: "note-nope", lat: 51.5, lon: -0.1 })).status === 404);
t4("setting one needs a name",
   (await noteAddr({ voter: "", id: dinner.id, lat: 51.5, lon: -0.1 })).status === 400);
t4("an over-long address is refused",
   (await noteAddr({ voter: "E", id: dinner.id, address: "x".repeat(201),
                     lat: 51.5, lon: -0.1 })).status === 400);

// --- editing one of your own entries in place, which the detail sheet does
const noteUpdate = (b) => call("/api/plan/note/update", { method: "POST", body: JSON.stringify(b) });

{
  const made = (await (await noteAdd({ voter: "Emily", label: "Coffee",
    day: "2026-09-13", start: "10:00", end: "11:00" })).json())
    .notes.find(n => n.label === "Coffee");
  await noteAddr({ voter: "Emily", id: made.id, address: "Somewhere", lat: 51.5, lon: -0.1 });

  let up = await (await noteUpdate({ voter: "Maya", id: made.id,
    label: "Coffee with Anna", start: "10:30", end: "11:30" })).json();
  let now = up.notes.find(n => n.id === made.id);
  t4("an entry can be renamed and re-timed", now.label === "Coffee with Anna" && now.start === "10:30");
  t4("its id does not change, so nothing pointing at it breaks", now.id === made.id);
  t4("its address survives the edit", now.lat === 51.5 && now.address === "Somewhere");
  t4("anyone can edit it, not only whoever added it", now.label === "Coffee with Anna");

  up = await (await noteUpdate({ voter: "Maya", id: made.id, day: "2026-09-15" })).json();
  now = up.notes.find(n => n.id === made.id);
  t4("changing only the day leaves the times alone",
     now.day === "2026-09-15" && now.start === "10:30" && now.end === "11:30");

  // The bug this guards: sending only an end time compared it against a start
  // that was never sent, so an impossible pair could be stored.
  t4("an end time alone is still checked against the stored start",
     (await noteUpdate({ voter: "M", id: made.id, end: "09:00" })).status === 400);
  t4("a start alone is checked against the stored end",
     (await noteUpdate({ voter: "M", id: made.id, start: "23:00" })).status === 400);

  t4("a day outside the trip is refused",
     (await noteUpdate({ voter: "M", id: made.id, day: "2026-12-01" })).status === 400);
  t4("a sight id is refused", (await noteUpdate({ voter: "M", id: "tower-of-london" })).status === 400);
  t4("an entry that is gone gives a 404",
     (await noteUpdate({ voter: "M", id: "note-nope", start: "10:00" })).status === 404);
  t4("editing needs a name", (await noteUpdate({ voter: "", id: made.id })).status === 400);
  t4("an over-long name is refused",
     (await noteUpdate({ voter: "M", id: made.id, label: "x".repeat(81) })).status === 400);

  await noteRm({ voter: "Emily", id: made.id });
}


// --- where the days start
const setBase = (b) => call("/api/trip/base", { method: "POST", body: JSON.stringify(b) });

const seeded = (await (await call("/api/sights")).json()).trip.base;
t4("a fresh database comes with somewhere to start from", !!seeded);
t4("and it is the hotel", seeded?.lat === 51.5116 && seeded?.lon === -0.0773);

let tb = await (await setBase({ voter: "Emily", name: "Somewhere else",
  lat: 51.52, lon: -0.1 })).json();
t4("it can be changed", tb.trip.base.lat === 51.52 && tb.trip.base.name === "Somewhere else");
t4("who changed it is recorded", tb.trip.setBy === "Emily");

tb = await (await setBase({ voter: "Emily", name: null, lat: null, lon: null })).json();
t4("it can be cleared", tb.trip.base === null);

tb = await (await setBase({ voter: "Emily", name: "Leonardo Royal",
  lat: 51.5116, lon: -0.0773 })).json();
t4("and set again", tb.trip.base.lat === 51.5116);

t4("half a coordinate is refused", (await setBase({ voter: "E", lat: 51.5 })).status === 400);
t4("an impossible latitude is refused",
   (await setBase({ voter: "E", lat: 999, lon: 0 })).status === 400);
t4("changing it needs a name", (await setBase({ voter: "", lat: 51.5, lon: -0.1 })).status === 400);
t4("an over-long address is refused",
   (await setBase({ voter: "E", name: "x".repeat(201), lat: 51.5, lon: -0.1 })).status === 400);

{
  // The point of it: routes can leave from the hotel rather than from nowhere.
  const { routeLinks } = await import("../public/route.js");
  const snap = await (await call("/api/sights")).json();
  const two = [snap.sights.find(s => s.id === "tower-of-london"),
               snap.sights.find(s => s.id === "tate-modern")];
  const fromHotel = routeLinks(two, "transit", snap.trip.base);
  t4("a route can start at the hotel",
     fromHotel.from === true &&
     fromHotel.google.includes(`origin=${encodeURIComponent("51.5116,-0.0773")}`));
  t4("and without it there is no origin", routeLinks(two).from === false);
}

// --- the trip drives the app, rather than being described by it
const tripSet = (b) => call("/api/trip/settings", { method: "POST", body: JSON.stringify(b) });
const memberAdd = (b) => call("/api/trip/member/add", { method: "POST", body: JSON.stringify(b) });
const memberRm = (b) => call("/api/trip/member/remove", { method: "POST", body: JSON.stringify(b) });
const travelSet = (b) => call("/api/trip/travel", { method: "POST", body: JSON.stringify(b) });

let tr = await (await call("/api/sights")).json();
t4("a fresh database has a trip", !!tr.trip.name && tr.trip.days.length > 0);
t4("its days come from its dates, not from a constant",
   tr.trip.days.length === 6 && tr.trip.days[0] === tr.trip.startDate &&
   tr.trip.days.at(-1) === tr.trip.endDate);

tr = await (await tripSet({ voter: "Emily", name: "Lisbon spring", destination: "Lisbon",
  startDate: "2027-04-02", endDate: "2027-04-06" })).json();
t4("changing the dates changes the days", tr.trip.days.length === 5);
t4("and the destination follows", tr.trip.destination === "Lisbon");
t4("a date from the old trip is now refused",
   (await call("/api/plan/set", { method: "POST",
     body: JSON.stringify({ voter: "E", sightId: "tower-of-london", day: "2026-09-13" }) })).status === 400);
t4("a date in the new trip is accepted",
   (await call("/api/plan/set", { method: "POST",
     body: JSON.stringify({ voter: "E", sightId: "tower-of-london", day: "2027-04-03" }) })).status === 200);
t4("a booking date follows the trip too",
   (await setStatus({ voter: "E", sightId: "london-eye", status: "booked",
                      bookedDate: "2026-09-13" })).status === 400);

t4("end before start is refused",
   (await tripSet({ voter: "E", startDate: "2027-04-06", endDate: "2027-04-02" })).status === 400);
t4("an absurdly long trip is refused",
   (await tripSet({ voter: "E", startDate: "2027-01-01", endDate: "2028-01-01" })).status === 400);
t4("a malformed date is refused",
   (await tripSet({ voter: "E", startDate: "02/04/2027" })).status === 400);
t4("changing the trip needs a name", (await tripSet({ voter: "", name: "x" })).status === 400);

// only what is sent changes
tr = await (await tripSet({ voter: "Emily", checkIn: "15:00", checkOut: "11:00" })).json();
t4("saving the hotel times leaves the dates alone",
   tr.trip.startDate === "2027-04-02" && tr.trip.base.checkIn === "15:00");

await tripSet({ voter: "Emily", name: "London 2026", destination: "London",
                startDate: "2026-09-11", endDate: "2026-09-16" });

// --- members
let mb = await (await memberAdd({ voter: "Emily", name: "Lena", note: "joins later" })).json();
t4("someone can be added", mb.members.some(m => m.name === "Lena"));
t4("their note is kept", mb.members.find(m => m.name === "Lena").note === "joins later");
t4("their key is the same identity votes use",
   mb.members.find(m => m.name === "Lena").key === "lena");

mb = await (await memberAdd({ voter: "Emily", name: "  lena  " })).json();
t4("adding the same person again does not split them",
   mb.members.filter(m => m.key === "lena").length === 1);

await post({ voter: "Lena", sightId: "tower-of-london", wanted: true });
const lena = mb.members.find(m => m.key === "lena");
mb = await (await memberRm({ voter: "Emily", id: lena.id })).json();
t4("someone can be taken off the list", !mb.members.some(m => m.key === "lena"));
t4("but their votes stay, because a list is not a ledger",
   (mb.votes["tower-of-london"] ?? []).some(v => v.toLowerCase() === "lena"));

t4("a nameless member is refused", (await memberAdd({ voter: "E", name: "" })).status === 400);
t4("adding needs a name of your own", (await memberAdd({ voter: "", name: "X" })).status === 400);
t4("removing something that is not a member is refused",
   (await memberRm({ voter: "E", id: "custom-x" })).status === 400);

// --- getting there and back
let tv = await (await travelSet({ voter: "Emily", direction: "out", mode: "Flight",
  carrier: "OS 455", from: "Graz", to: "London Heathrow", date: "2026-09-11",
  departTime: "11:20", arriveTime: "13:05", reference: "ABC123" })).json();
const outLeg = tv.travel.find(l => l.direction === "out");
t4("the way out can be recorded", outLeg.carrier === "OS 455");
t4("its times are kept", outLeg.departTime === "11:20" && outLeg.arriveTime === "13:05");
t4("its reference is kept", outLeg.reference === "ABC123");

tv = await (await travelSet({ voter: "Emily", direction: "out", carrier: "OS 457" })).json();
t4("saving it again replaces rather than adds",
   tv.travel.filter(l => l.direction === "out").length === 1 &&
   tv.travel.find(l => l.direction === "out").carrier === "OS 457");

tv = await (await travelSet({ voter: "Emily", direction: "back", carrier: "OS 456",
  date: "2026-09-16", departTime: "07:00" })).json();
t4("both directions can exist at once", tv.travel.length === 2);

tv = await (await travelSet({ voter: "Emily", direction: "back", clear: true })).json();
t4("one can be cleared without touching the other",
   tv.travel.length === 1 && tv.travel[0].direction === "out");

t4("a third direction is refused",
   (await travelSet({ voter: "E", direction: "sideways" })).status === 400);
t4("a malformed time is refused",
   (await travelSet({ voter: "E", direction: "out", departTime: "25:99" })).status === 400);
t4("a malformed date is refused",
   (await travelSet({ voter: "E", direction: "out", date: "11/09/2026" })).status === 400);
t4("recording travel needs a name",
   (await travelSet({ voter: "", direction: "out" })).status === 400);

{
  const st = await (await call("/api/state")).json();
  t4("/api/state carries the members and the travel",
     Array.isArray(st.members) && Array.isArray(st.travel) && !!st.trip);
}

t4("/api/state carries your own entries",
   Array.isArray((await (await call("/api/state")).json()).notes));
{
  // A sight placed by hand and an entry of your own must not collide.
  await noteAdd({ voter: "E", label: "Dinner", day: "2026-09-13" });
  await planSet({ voter: "E", sightId: "tate-modern", day: "2026-09-13" });
  const both = await (await call("/api/state")).json();
  t4("entries of your own are kept apart from sight placements",
     both.notes.some(n => n.label === "Dinner") &&
     both.plan.some(e => e.id === "tate-modern") &&
     !both.plan.some(e => e.id.startsWith("note-")));
}

/* ------------------------------------------------------------- maps routes */

console.log("\nroutes");
let ok5 = 0, fail5 = 0;
const t5 = (name, cond) => { cond ? (ok5++, console.log("  ✓", name)) : (fail5++, console.log("  ✗", name)); };

const { routeLinks, routeFrom, hasPlace, MAX_WAYPOINTS } =
  await import("../public/route.js");

const A = { name: "A", lat: 51.5081, lon: -0.0761 };
const B = { name: "B", lat: 51.5055, lon: -0.0754 };
const C = { name: "C", lat: 51.5055, lon: -0.0910 };
const NOWHERE = { name: "Dinner" };
const day = [A, B, NOWHERE, C];

const whole = routeLinks(day);
t5("a day with places gets a route", !!whole);
t5("stops without a place are left out, not silently dropped",
   whole.used === 3 && whole.skipped === 1);
t5("the last stop is the destination", whole.google.includes(encodeURIComponent("51.5055,-0.091")));
t5("the earlier ones are waypoints", whole.google.includes("waypoints="));
t5("no origin, so it starts from where you are", !whole.google.includes("origin="));
t5("the Apple link has no saddr either", !whole.apple.includes("saddr="));
t5("both are valid URLs", (() => {
  try { new URL(whole.google); new URL(whole.apple); return true; } catch { return false; }
})());
t5("transit is the default", whole.google.includes("travelmode=transit"));
t5("walking can be asked for", routeLinks(day, "walking").google.includes("travelmode=walking"));

// --- the point of the exercise: you have already done the first two
const rest = routeFrom(day, 2);
t5("a route can start partway through the day", rest.used === 1);
const restFromB = routeFrom(day, 1);
t5("starting at the second stop covers it and everything after", restFromB.used === 2);
t5("and leaves out what came before",
   !restFromB.google.includes(encodeURIComponent("51.5081,-0.0761")));
t5("the last stop's route is just that stop",
   routeFrom(day, 3).used === 1);

t5("an empty day has no route", routeLinks([]) === null);
t5("a day with nothing placeable has no route", routeLinks([NOWHERE, NOWHERE]) === null);
t5("a single stop still gets a route", routeLinks([A]).used === 1);
t5("an index past the end gives nothing", routeFrom(day, 99) === null);
t5("a negative index gives nothing", routeFrom(day, -1) === null);
t5("hasPlace rejects a missing coordinate", !hasPlace({ lat: 51.5 }) && !hasPlace(null));

// --- starting from where you are
const ME = { lat: 51.5116, lon: -0.0773 };
const fromMe = routeLinks(day, "transit", ME);
t5("an origin goes into the Google link",
   fromMe.google.includes(`origin=${encodeURIComponent("51.5116,-0.0773")}`));
t5("and into the Apple link",
   fromMe.apple.includes(`saddr=${encodeURIComponent("51.5116,-0.0773")}`));
t5("the result says it has one", fromMe.from === true);
t5("without one, neither link carries a start",
   whole.from === false && !whole.google.includes("origin=") && !whole.apple.includes("saddr="));
t5("a malformed origin is ignored rather than trusted",
   routeLinks(day, "transit", { lat: "x", lon: 1 }).from === false);
t5("a null origin is fine", routeLinks(day, "transit", null).from === false);
t5("the stops are the same either way",
   routeLinks(day, "transit", ME).used === whole.used);
t5("a partial route can start from you too",
   routeFrom(day, 1, "transit", ME).from === true);

t5("a long day is capped and says so", (() => {
  const many = Array.from({ length: 12 }, (_, i) => ({ lat: 51.5 + i / 1000, lon: -0.1 }));
  const r = routeLinks(many);
  return r.capped && r.google.split("%7C").length - 1 === MAX_WAYPOINTS - 1;
})());

// --- the data those routes depend on
t5("every built-in sight has coordinates",
   list.sights.every(s => typeof s.lat === "number" && typeof s.lon === "number"));
t5("and all of them are in Greater London",
   list.sights.every(s => s.lat > 51.2 && s.lat < 51.8 && s.lon > -0.65 && s.lon < 0.4));

// --- Phase 1, step 1: the trip is a row, and everything belongs to it
const tripCall = (p, b) => call(p, { method: "POST", body: JSON.stringify(b) });

let ts = await (await tripCall("/api/trip/settings",
  { voter: "Emily", name: "London 2026", destination: "London" })).json();
t5("the trip is trip 1", ts.trip.id === 1 && ts.trip.name === "London 2026");
t5("its days come from the trips table", ts.trip.days.length === 6);
t5("there is exactly one trip row", db.prepare("SELECT COUNT(*) AS n FROM trips").get().n === 1);

let mm = await (await tripCall("/api/trip/member/add", { voter: "Emily", name: "Roswitha" })).json();
t5("a member can be added", mm.members.some(m => m.name === "Roswitha"));
mm = await (await tripCall("/api/trip/member/add",
  { voter: "Emily", name: "roswitha", note: "arrives late" })).json();
t5("adding the same name again updates rather than duplicates",
   mm.members.filter(m => m.key === "roswitha").length === 1 &&
   mm.members.find(m => m.key === "roswitha").note === "arrives late");

const tvOut = await (await tripCall("/api/trip/travel",
  { voter: "Emily", direction: "out", carrier: "BA2865", date: "2026-09-11" })).json();
t5("the journey out is recorded", tvOut.travel.find(x => x.direction === "out")?.carrier === "BA2865");

t5("every vote belongs to trip 1",
   db.prepare("SELECT COUNT(*) AS n FROM votes WHERE trip_id <> 1").get().n === 0);
t5("so does every added sight, comment, booking, plan entry, note, member and journey",
   ["custom_sights", "comments", "booking_status", "plan_entries", "plan_notes",
    "trip_members", "trip_travel"].every(tb =>
     db.prepare(`SELECT COUNT(*) AS n FROM ${tb} WHERE trip_id <> 1`).get().n === 0));

// A second trip may have a member of the same name and its own journeys —
// the two keys that used to be global are per trip now.
db.prepare("INSERT INTO trips (id, name, created_at) VALUES (2, 'Rome', 0)").run();
let separate = true;
try {
  db.prepare(`INSERT INTO trip_members (id, trip_id, name, name_key, added_by, created_at)
              VALUES ('m-rome', 2, 'Roswitha', 'roswitha', 'Emily', 0)`).run();
  db.prepare(`INSERT INTO trip_travel (trip_id, direction, set_by, updated_at)
              VALUES (2, 'out', 'Emily', 0)`).run();
} catch { separate = false; }
t5("a second trip can have the same member name and its own journey", separate);

const snap2 = await (await call("/api/sights")).json();
t5("and trip 1 does not see trip 2's rows",
   !snap2.members.some(m => m.id === "m-rome") &&
   snap2.travel.filter(x => x.direction === "out").length === 1);

// --- Phase 1, step 2: one items table, whoever the place came from
{
  const snap = await (await call("/api/sights")).json();
  const rows = (src) => db.prepare("SELECT COUNT(*) AS n FROM items WHERE source = ? AND trip_id = 1").get(src).n;
  t5("the built-ins are rows in items, not a file", rows("builtin") === 55);
  t5("and the API serves them from there", snap.sights.length === rows("builtin"));
  t5("every added place is a row in the same table", rows("added") === snap.custom.length);
  t5("nothing is read from custom_sights any more",
     db.prepare("SELECT COUNT(*) AS n FROM custom_sights").get().n === 0);

  const globe = snap.sights.find(x => x.id === "shakespeares-globe");
  t5("a summary with a semicolon in it survived the import", /;/.test(globe?.summary ?? ""));
  t5("the built-in shape is unchanged on the wire",
     ["rank", "tier", "categories", "openOn", "flags", "wiki", "name_de", "priceLabel_de", "lat", "lon"]
       .every(k => k in snap.sights[0]) && Array.isArray(snap.sights[0].openOn));
  t5("the order is the list order", snap.sights[0].rank === 1 && snap.sights.at(-1).rank === 55);

  const added = (await (await add({ voter: "Maya", name: "Sky Pod", costs: true, priceLabel: "£8" })).json());
  const mine = added.custom.find(c => c.name === "Sky Pod");
  const row = db.prepare("SELECT source, cost, price_label, trip_id FROM items WHERE id = ?").get(mine.id);
  t5("an added place lands in items as 'added' on this trip",
     row?.source === "added" && row.trip_id === 1);
  t5("'costs something' is stored as cost = paid", row?.cost === "paid" && mine.costs === true);

  const cheaper = await (await call("/api/sights/edit", { method: "POST",
    body: JSON.stringify({ voter: "Maya", id: mine.id, costs: false, bookingRequired: true }) })).json();
  const edited = cheaper.custom.find(c => c.id === mine.id);
  t5("editing it back to free clears the price",
     edited.costs === false && edited.priceLabel === null && edited.bookingRequired === true &&
     db.prepare("SELECT cost FROM items WHERE id = ?").get(mine.id).cost === "free");

  t5("a built-in still cannot be edited as if it were added",
     (await call("/api/sights/edit", { method: "POST",
        body: JSON.stringify({ voter: "Maya", id: "tower-of-london", costs: true, bookingRequired: false }) })).status === 400);

  const gone = await (await del({ voter: "Maya", id: mine.id })).json();
  t5("removing it deletes the items row",
     !gone.custom.some(c => c.id === mine.id) &&
     db.prepare("SELECT COUNT(*) AS n FROM items WHERE id = ?").get(mine.id).n === 0);
  t5("the built-ins are untouched by that",
     db.prepare("SELECT COUNT(*) AS n FROM items WHERE source = 'builtin'").get().n === 55);
}

// --- Phase 1, step 3: the trip comes from the URL
{
  const one = await (await call("/api/t/1/sights")).json();
  const alias = await (await call("/api/sights")).json();
  t5("/api/t/1/… is the same trip as the old path",
     one.trip.id === 1 && one.sights.length === alias.sights.length &&
     JSON.stringify(one.votes) === JSON.stringify(alias.votes));
  t5("a trip that does not exist is a 404", (await call("/api/t/9/sights")).status === 404);
  t5("and so is a trip that is not a number", (await call("/api/t/london/sights")).status === 404);
  t5("and a negative or zero one", (await call("/api/t/0/sights")).status === 404 &&
     (await call("/api/t/-1/sights")).status === 404);
  t5("a path under a trip that is not an endpoint is a 404, not a 500",
     (await call("/api/t/1/nothing")).status === 404);

  // trip 2 was created by the step 1 checks above, with no places of its own
  const two = await (await call("/api/t/2/sights")).json();
  t5("a second trip answers as itself", two.trip.id === 2 && two.trip.name === "Rome");
  t5("with none of trip 1's places", two.sights.length === 0 && two.custom.length === 0);
  t5("or votes, comments, bookings, plan, notes",
     Object.keys(two.votes).length === 0 && Object.keys(two.comments).length === 0 &&
     two.bookings.length === 0 && two.plan.length === 0 && two.notes.length === 0);
  t5("but its own member and journey", two.members.some(m => m.id === "m-rome") &&
     two.travel.some(x => x.direction === "out"));

  const p2 = (b) => call("/api/t/2/" + b.path, { method: "POST", body: JSON.stringify(b.body) });
  t5("a trip-1 place cannot be voted on from trip 2",
     (await p2({ path: "vote", body: { sightId: "tower-of-london", voter: "Emily", wanted: true } })).status === 400);

  const named = await (await p2({ path: "trip/settings",
    body: { voter: "Emily", name: "Roma", destination: "Rome", startDate: "2027-04-01", endDate: "2027-04-04" } })).json();
  t5("trip 2's settings change trip 2", named.trip.id === 2 && named.trip.name === "Roma" && named.trip.days.length === 4);
  t5("and not trip 1", (await (await call("/api/sights")).json()).trip.name === "London 2026");

  const addedTwo = await (await p2({ path: "sights/add", body: { voter: "Emily", name: "Colosseum", costs: true } })).json();
  const col = addedTwo.custom.find(c => c.name === "Colosseum");
  t5("a place added on trip 2 belongs to trip 2", !!col &&
     db.prepare("SELECT trip_id FROM items WHERE id = ?").get(col.id).trip_id === 2);
  t5("trip 1 does not see it", !(await (await call("/api/sights")).json()).custom.some(c => c.id === col.id));
  t5("the vote that came with it is on trip 2 too",
     db.prepare("SELECT trip_id FROM votes WHERE sight_id = ?").get(col.id).trip_id === 2);
  const planTwo = await (await p2({ path: "plan/set", body: { voter: "Emily", sightId: col.id, day: "2027-04-02" } })).json();
  t5("a day of trip 2 is a valid plan day there", planTwo.plan.some(e => e.id === col.id));
  t5("a day of trip 1 is not", (await p2({ path: "plan/set",
     body: { voter: "Emily", sightId: col.id, day: "2026-09-12" } })).status === 400);
  t5("trip 1 cannot put trip 2's place on its plan",
     (await call("/api/plan/set", { method: "POST",
        body: JSON.stringify({ voter: "Emily", sightId: col.id, day: "2026-09-12" }) })).status === 400);
}

// --- Phase 1, step 4: the pages live under a trip
{
  const served = async (p) => (await call(p)).text();
  t5("/t/1/ serves the Sights page", await served("/t/1/") === "static /index.html");
  t5("/t/1/plan serves the Plan page", await served("/t/1/plan") === "static /plan.html");
  t5("/t/2/bookings serves Bookings for trip 2", await served("/t/2/bookings") === "static /bookings.html");
  t5("/t/1/details/ tolerates a trailing slash", await served("/t/1/details/") === "static /details.html");

  const r = (p) => call(p, { redirect: "manual" });
  const loc = async (p) => (await r(p)).headers.get("location");
  t5("the old / redirects to trip 1", (await r("/")).status === 302 && (await loc("/")).endsWith("/t/1/"));
  t5("and /plan, keeping any query", (await loc("/plan?x=1")).endsWith("/t/1/plan?x=1"));
  t5("/t/1 without a slash redirects to /t/1/", (await loc("/t/1")).endsWith("/t/1/"));

  t5("a trip that does not exist is a 404 page", (await call("/t/9/plan")).status === 404 &&
     /No such trip/.test(await served("/t/9/plan")));
  t5("so is a trip that is not a number", (await call("/t/rome/")).status === 404);
  t5("and a page that does not exist inside a trip", (await call("/t/1/nothing")).status === 404);
  t5("shared files are served as they are", await served("/app.css") === "static /app.css" &&
     await served("/img/manifest.json") === "static /img/manifest.json");
  t5("the page files themselves are still reachable", await served("/plan.html") === "static /plan.html");
}

// --- Phase 2, step 5: sign in by email link
{
  const post = (p, b, headers = {}) => call(p, { method: "POST", headers, body: JSON.stringify(b) });
  const req = (b) => post("/api/auth/request", b);

  t5("a bad address is refused", (await req({ email: "not-an-email" })).status === 400);
  t5("so is a missing one", (await req({})).status === 400);

  let d = await (await req({ email: "  Emily@Example.COM ", next: "/t/1/plan?x=1" })).json();
  t5("a request answers ok", d.ok === true);
  t5("with no key set, the link comes back for development", typeof d.devLink === "string" && d.devLink.includes("/auth?token="));
  t5("only a hash of the token is stored",
     db.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE token_hash LIKE '%' || ? || '%'").get(d.devLink.split("token=")[1]).n === 0
     && db.prepare("SELECT email FROM login_tokens").get().email === "emily@example.com");

  t5("nobody is signed in before the link is opened",
     (await (await call("/api/auth/me")).json()).user === null);

  const link = new URL(d.devLink);
  const r1 = await call(link.pathname + link.search, { redirect: "manual" });
  const cookie = (r1.headers.get("set-cookie") || "").split(";")[0];
  t5("opening the link redirects to where you were", r1.status === 302 && r1.headers.get("location").endsWith("/t/1/plan?x=1"));
  t5("and sets a session cookie, HttpOnly", cookie.startsWith("trip_session=") &&
     /HttpOnly/.test(r1.headers.get("set-cookie")) && /SameSite=Lax/.test(r1.headers.get("set-cookie")));
  t5("a user was created from the address",
     db.prepare("SELECT display_name FROM users WHERE email = 'emily@example.com'").get()?.display_name === "Emily");

  const me = await (await call("/api/auth/me", { headers: { cookie } })).json();
  t5("with the cookie, /me knows who you are", me.user?.email === "emily@example.com" && me.user.displayName === "Emily");
  t5("the session id is stored hashed",
     db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE id_hash = ?").get(cookie.split("=")[1]).n === 0 &&
     db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n === 1);

  t5("the link works once", (await call(link.pathname + link.search, { redirect: "manual" })).status === 400);
  t5("a made-up token is refused", (await call("/auth?token=" + "x".repeat(40), { redirect: "manual" })).status === 400);
  t5("and shows a page, not JSON", /expired/.test(await (await call("/auth?token=nope")).text()));

  // the same person again: no second user, a second session
  d = await (await req({ email: "emily@example.com" })).json();
  const l2 = new URL(d.devLink);
  const r2 = await call(l2.pathname + l2.search, { redirect: "manual" });
  t5("signing in again finds the same user",
     db.prepare("SELECT COUNT(*) AS n FROM users").get().n === 1 &&
     db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n === 2);
  t5("with no next, the link lands on the front page", r2.headers.get("location").endsWith("/"));

  // an expired link
  d = await (await req({ email: "emily@example.com" })).json();
  db.prepare("UPDATE login_tokens SET expires_at = 0 WHERE used_at IS NULL").run();
  const l3 = new URL(d.devLink);
  t5("an expired link is refused", (await call(l3.pathname + l3.search, { redirect: "manual" })).status === 400);

  // next must stay on this site
  d = await (await req({ email: "emily@example.com", next: "https://elsewhere.example/steal" })).json();
  const l4 = new URL(d.devLink);
  t5("an off-site next is ignored",
     (await call(l4.pathname + l4.search, { redirect: "manual" })).headers.get("location") === "https://x/");
  d = await (await req({ email: "emily@example.com", next: "//elsewhere.example" })).json();
  const l5 = new URL(d.devLink);
  t5("and so is a protocol-relative one",
     (await call(l5.pathname + l5.search, { redirect: "manual" })).headers.get("location") === "https://x/");

  // rate limit: five an hour, and the answer does not change
  const before = db.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE email = 'maya@example.com'").get().n;
  let last;
  for (let i = 0; i < 7; i++) last = await (await req({ email: "maya@example.com" })).json();
  const after = db.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE email = 'maya@example.com'").get().n;
  t5("more than five requests an hour stop producing tokens", after - before === 5);
  t5("but the answer still says ok, giving nothing away", last.ok === true && last.sent === true && !last.devLink);

  // sign out
  const out = await post("/api/auth/logout", {}, { cookie });
  t5("signing out clears the cookie", /Max-Age=0/.test(out.headers.get("set-cookie") || ""));
  t5("and the session is gone", (await (await call("/api/auth/me", { headers: { cookie } })).json()).user === null);

  // with a key set, mail goes to Resend and the link stays out of the answer
  const realFetch = globalThis.fetch;
  let sentMail = null;
  globalThis.fetch = async (u, init) => { sentMail = { url: String(u), body: JSON.parse(init.body), auth: init.headers.authorization }; return new Response("{}", { status: 200 }); };
  const keyed = { ...env, RESEND_API_KEY: "re_test", MAIL_FROM: "Trips <hi@example.com>" };
  const sent = await (await worker.fetch(new Request("https://x/api/auth/request", { method: "POST",
    body: JSON.stringify({ email: "roswitha@example.com", lang: "de" }) }), keyed)).json();
  t5("with a key, the request sends through Resend", sentMail?.url === "https://api.resend.com/emails" &&
     sentMail.auth === "Bearer re_test" && sentMail.body.to[0] === "roswitha@example.com" && sentMail.body.from === "Trips <hi@example.com>");
  t5("in the asked-for language", sentMail.body.subject === "Dein Anmeldelink" && /\/auth\?token=/.test(sentMail.body.text));
  t5("and the link is not in the answer", sent.ok === true && sent.sent === true && !sent.devLink);
  globalThis.fetch = async () => new Response("nope", { status: 500 });
  t5("a failed send is reported, not swallowed",
     (await worker.fetch(new Request("https://x/api/auth/request", { method: "POST",
        body: JSON.stringify({ email: "roswitha@example.com" }) }), keyed)).status === 502);
  globalThis.fetch = realFetch;
}

console.log(`\n${ok + ok2 + ok3 + ok4 + ok5} passed, ${fail + fail2 + fail3 + fail4 + fail5} failed`);
process.exit(fail + fail2 + fail3 + fail4 + fail5 ? 1 : 0);
