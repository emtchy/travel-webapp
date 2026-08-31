#!/usr/bin/env node
/**
 * Fill in `lat` / `lon` for every sight in src/sights.js.
 *
 *   npm run geo
 *
 * Coordinates come from the same Wikipedia API the images use, keyed on each
 * sight's `wiki` title. Safe to re-run: it only fills in what's missing, so
 * hand-corrected values are never overwritten.
 *
 * Two traps this script exists to handle:
 *
 *   1. `prop=coordinates` defaults to colimit=10. Without `colimit=max` you
 *      silently get coordinates for a fraction of each batch and no error.
 *   2. Ambiguous titles resolve to the wrong planet entirely — "Columbia Road"
 *      returns a street in Washington DC. Anything outside the bounding box is
 *      discarded, because a wrong coordinate looks exactly like a right one.
 *
 * Whatever the API can't place correctly lives in MANUAL below.
 */
import { readFile, writeFile } from "node:fs/promises";
import { SIGHTS } from "../src/sights.js";

const SRC = new URL("../src/sights.js", import.meta.url);
const UA = "travel-webapp/1.0 (trip planner)";

// Greater London plus the day-trip fringe: Kew, Hampton Court, Eltham and the
// Warner Bros. tour at Leavesden all have to fall inside this.
const BBOX = { minLat: 51.2, maxLat: 51.8, minLon: -0.65, maxLon: 0.4 };
const inBox = (p) =>
  p && p.lat > BBOX.minLat && p.lat < BBOX.maxLat &&
       p.lon > BBOX.minLon && p.lon < BBOX.maxLon;

// Verified by hand via OpenStreetMap Nominatim. Either the Wikipedia article
// carries no coordinates, or the title is ambiguous enough to land elsewhere.
const MANUAL = {
  "columbia-road-flower-market":            { lat: 51.5294, lon: -0.0694 }, // else Washington DC
  "guildhall-roman-amphitheatre":           { lat: 51.5159, lon: -0.0920 },
  "changing-of-the-guard":                  { lat: 51.5008, lon: -0.1430 }, // palace forecourt
  "platform-9-3-4":                         { lat: 51.5324, lon: -0.1230 }, // King's Cross
  "house-of-minalima":                      { lat: 51.5133, lon: -0.1304 }, // 26 Greek Street
  "abbey-road-crossing":                    { lat: 51.5320, lon: -0.1782 },
  "regent-s-canal-little-venice-to-camden": { lat: 51.5230, lon: -0.1833 }, // walk start
};

/* ----------------------------------------------------------------- fetch */

const titles = [...new Set(SIGHTS.map((s) => s.wiki).filter(Boolean))];
const byTitle = {};

for (let i = 0; i < titles.length; i += 45) {
  const batch = titles.slice(i, i + 45);
  const api =
    "https://en.wikipedia.org/w/api.php" +
    "?action=query&format=json&formatversion=2&redirects=1" +
    "&prop=coordinates&colimit=max&titles=" +
    encodeURIComponent(batch.join("|"));

  const res = await fetch(api, { headers: { "user-agent": UA } });
  if (!res.ok) {
    console.warn(`  batch ${i / 45 + 1} failed: HTTP ${res.status}`);
    continue;
  }
  const data = await res.json();

  for (const page of data?.query?.pages || []) {
    const c = page.coordinates?.[0];
    if (c) byTitle[page.title] = { lat: c.lat, lon: c.lon };
  }
  for (const r of data?.query?.redirects  || []) if (byTitle[r.to]) byTitle[r.from] = byTitle[r.to];
  for (const n of data?.query?.normalized || []) if (byTitle[n.to]) byTitle[n.from] = byTitle[n.to];
}

/* ---------------------------------------------------------------- apply */

const round = (n) => Math.round(n * 10000) / 10000;

let fromWiki = 0, fromManual = 0, kept = 0, rejected = [];
const missing = [];

for (const sight of SIGHTS) {
  if (typeof sight.lat === "number" && typeof sight.lon === "number") {
    kept++;                       // already placed by hand — leave it alone
    continue;
  }
  const manual = MANUAL[sight.id];
  if (manual) {
    sight.lat = manual.lat;
    sight.lon = manual.lon;
    fromManual++;
    continue;
  }
  const found = byTitle[sight.wiki];
  if (found && inBox(found)) {
    sight.lat = round(found.lat);
    sight.lon = round(found.lon);
    fromWiki++;
    continue;
  }
  if (found) rejected.push(`${sight.id} → ${found.lat.toFixed(3)}, ${found.lon.toFixed(3)}`);
  missing.push(sight);
}

/* ----------------------------------------------------------------- write */

// sights.js is a JSON array behind an `export const`. Rewrite it wholesale and
// keep the header comment, so the file stays hand-editable afterwards.
const current = await readFile(SRC, "utf8");
const header = current.slice(0, current.indexOf("export const SIGHTS"));
await writeFile(SRC, `${header}export const SIGHTS = ${JSON.stringify(SIGHTS, null, 2)};\n`);

console.log(`\n  ${fromWiki} from Wikipedia, ${fromManual} from MANUAL, ${kept} already set`);
if (rejected.length) {
  console.log(`\n  Rejected — outside the bounding box, so almost certainly the wrong place:`);
  for (const r of rejected) console.log(`    ${r}`);
}
if (missing.length) {
  console.log(`\n  Still unplaced (${missing.length}) — add them to MANUAL in this script:`);
  for (const s of missing) console.log(`    ${s.id}  (wiki: "${s.wiki}")`);
} else {
  console.log(`\n  All ${SIGHTS.length} sights have coordinates.`);
}
