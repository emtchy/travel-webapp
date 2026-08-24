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

console.log(`\n${ok + ok2} passed, ${fail + fail2} failed`);
process.exit(fail + fail2 ? 1 : 0);
