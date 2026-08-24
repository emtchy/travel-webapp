#!/usr/bin/env node
/**
 * Optional: download a photo for each sight from Wikipedia into public/img/,
 * so the deployed page doesn't hit Wikipedia at runtime.
 *
 *   node scripts/fetch-images.mjs
 *
 * Then set USE_LOCAL_IMAGES = true near the top of the <script> in
 * public/index.html (or just delete public/img to go back to runtime fetching).
 *
 * Images come from Wikipedia/Wikimedia Commons. Most are CC-licensed and
 * require attribution — public/img/CREDITS.json records the source page for
 * each one. Check the licence before using these anywhere public.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { SIGHTS } from "../src/sights.js";

const OUT = new URL("../public/img/", import.meta.url);
const UA = "london-sights-vote/1.0 (private trip planner)";

await mkdir(OUT, { recursive: true });

const titles = [...new Set(SIGHTS.map((s) => s.wiki))];
const api =
  "https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1" +
  "&prop=pageimages&piprop=thumbnail&pithumbsize=800&titles=" +
  encodeURIComponent(titles.join("|"));

const res = await fetch(api, { headers: { "user-agent": UA } });
const data = await res.json();

const byTitle = {};
for (const page of Object.values(data?.query?.pages || {})) {
  if (page.thumbnail?.source) byTitle[page.title] = page.thumbnail.source;
}
for (const r of data?.query?.redirects || []) if (byTitle[r.to]) byTitle[r.from] = byTitle[r.to];
for (const n of data?.query?.normalized || []) if (byTitle[n.to]) byTitle[n.from] = byTitle[n.to];

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

await writeFile(new URL("CREDITS.json", OUT), JSON.stringify(credits, null, 2));
console.log(`\n${saved}/${SIGHTS.length} images saved to public/img/`);
console.log("Attribution recorded in public/img/CREDITS.json — check licences before public use.");
