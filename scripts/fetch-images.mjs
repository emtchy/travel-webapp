#!/usr/bin/env node
/**
 * Download a photo for each sight into public/img/ and write a manifest the
 * page reads instead of calling Wikipedia at runtime.
 *
 *   npm run images
 *
 * This is the reliable path: the files are committed and served from your own
 * origin, so there is no API, no CORS and no cache to go wrong. Delete
 * public/img/ to fall back to fetching at runtime.
 *
 * Images come from Wikipedia/Wikimedia Commons. Most are CC-licensed and need
 * attribution — public/img/CREDITS.json records the source page for each one.
 * Check the licence before using these anywhere public.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { SIGHTS } from "../src/sights.js";

const OUT = new URL("../public/img/", import.meta.url);
const UA = "london-sights-vote/1.0 (private trip planner)";

await mkdir(OUT, { recursive: true });

const titles = [...new Set(SIGHTS.map((s) => s.wiki))];
// `pilimit` matters: without it the API returns a thumbnail for the FIRST
// title only, and every other card falls back to a placeholder.
const byTitle = {};

for (let i = 0; i < titles.length; i += 45) {
  const batch = titles.slice(i, i + 45);
  const api =
    "https://en.wikipedia.org/w/api.php" +
    "?action=query&format=json&formatversion=2&redirects=1" +
    "&prop=pageimages&piprop=thumbnail&pithumbsize=800" +
    `&pilimit=${batch.length}&titles=` +
    encodeURIComponent(batch.join("|"));

  const res = await fetch(api, { headers: { "user-agent": UA } });
  const data = await res.json();

  for (const page of data?.query?.pages || []) {
    if (page.thumbnail?.source) byTitle[page.title] = page.thumbnail.source;
  }
  for (const r of data?.query?.redirects || []) if (byTitle[r.to]) byTitle[r.from] = byTitle[r.to];
  for (const n of data?.query?.normalized || []) if (byTitle[n.to]) byTitle[n.from] = byTitle[n.to];
}

const credits = {};
let saved = 0;

for (const sight of SIGHTS) {
  const src = byTitle[sight.wiki];
  if (!src) {
    console.warn(`  no image found for ${sight.id} (${sight.wiki})`);
    continue;
  }
  const ext = (src.match(/\.(jpe?g|png|webp)/i)?.[1] || "jpg").toLowerCase();
  const file = new URL(`${sight.id}.${ext === "jpeg" ? "jpg" : ext}`, OUT);

  const img = await fetch(src, { headers: { "user-agent": UA } });
  if (!img.ok) {
    console.warn(`  failed to download ${sight.id}: HTTP ${img.status}`);
    continue;
  }
  await writeFile(file, Buffer.from(await img.arrayBuffer()));

  credits[sight.id] = {
    file: file.pathname.split("/").pop(),
    source: src,
    page: `https://en.wikipedia.org/wiki/${encodeURIComponent(sight.wiki)}`,
  };
  saved++;
  console.log(`  saved ${sight.id}`);
}

const manifest = Object.fromEntries(
  Object.entries(credits).map(([id, c]) => [id, `/img/${c.file}`])
);
await writeFile(new URL("manifest.json", OUT), JSON.stringify(manifest, null, 2));
await writeFile(new URL("CREDITS.json", OUT), JSON.stringify(credits, null, 2));

const missed = SIGHTS.filter((s) => !credits[s.id]);
console.log(`\n${saved}/${SIGHTS.length} images saved to public/img/`);
if (missed.length) {
  console.log(`\nNo image found for ${missed.length}:`);
  for (const s of missed) console.log(`  ${s.id}  (wiki: "${s.wiki}")`);
  console.log("\nFix by editing the `wiki` field in src/sights.js, or drop a file");
  console.log("into public/img/ named <id>.jpg and add it to manifest.json by hand.");
}
console.log("\nNow commit public/img/ and redeploy — the page prefers these over Wikipedia.");
console.log("Attribution is in public/img/CREDITS.json; check licences before public use.");
