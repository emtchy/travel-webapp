# London sights — vote page

One page, 33 sights, shared votes. Everyone types their name, taps **Want this**
on what they'd like to do, and sees everyone else's picks live.

Runs entirely on Cloudflare's free tier: one Worker serves both the page and the
API, and votes live in D1 (Cloudflare's SQLite). No build step, no framework,
no npm dependencies at runtime.

```
public/index.html      the whole frontend — HTML, CSS and JS in one file
src/worker.js          the API, and the static-file fallthrough
src/sights.js          the 33 sights (generated; edit freely)
schema.sql             one table
wrangler.toml          config — you paste your database id here
scripts/fetch-images.mjs   optional: self-host the photos
```

## Deploy (about five minutes)

You need a free Cloudflare account and Node 18+.

```bash
npm install                                   # just wrangler, as a dev dependency
npx wrangler login                            # opens a browser once

npx wrangler d1 create london-votes           # prints a database_id — copy it
```

Paste that id into `wrangler.toml`, replacing `PASTE_YOUR_DATABASE_ID_HERE`.

```bash
npm run db:remote                             # creates the votes table
npm run deploy                                # ships it
```

Wrangler prints the URL — something like
`https://london-sights-vote.<your-subdomain>.workers.dev`. Send that to the
group. That's the whole thing.

### Running it locally first

```bash
npm run db:local     # local copy of the schema
npm run dev          # http://localhost:8787
```

`wrangler dev` uses a separate local database, so you can click around without
touching the real votes.

## Seeing the results

```bash
npm run results
```

```
sight_id                     votes  who
tower-of-london                  4  Manuel, Anna, Tom, Lena
sir-john-soane-s-museum          3  Manuel, Anna, Lena
...
```

Or just open the page and hit the **Most wanted** filter.

## Locking it down

The page is unlisted but public — anyone with the URL can vote. `noindex` keeps
it out of search results. If you want a passphrase:

```bash
npx wrangler secret put ACCESS_CODE     # type the passphrase when prompted
```

The page then asks for it once and remembers it. Remove it with
`npx wrangler secret delete ACCESS_CODE`.

## Photos

By default the page asks Wikipedia for a lead photo for all 33 sights in a
single request on first load, then caches the URLs in the visitor's browser for
30 days. Nothing to host, and no dead links to maintain. If a photo can't be
found the card shows a lettered placeholder instead — the page works fine
either way.

To self-host them instead:

```bash
npm run images       # downloads into public/img/ + writes CREDITS.json
```

Most Wikimedia images are CC-licensed and need attribution. `CREDITS.json`
records the source page for each one — check the licence before using any of
these outside a private group.

## Editing the list

`src/sights.js` is a plain array. Add, remove or reword freely:

```js
{
  id: "tower-of-london",      // the vote key — changing it resets that row's votes
  rank: 1,
  name: "Tower of London",
  summary: "Nine hundred years of Norman keep…",
  area: "Tower Hill",
  station: "Tower Hill",
  cost: "paid",               // "free" | "free-limited" | "paid" | "mixed"
  priceLabel: "£37",
  bookingRequired: true,
  url: "https://www.hrp.org.uk/tower-of-london/",
  wiki: "Tower of London",    // Wikipedia article title, for the photo
}
```

Redeploy with `npm run deploy`. Votes are keyed on `id`, so keep ids stable and
old votes survive any amount of rewording.

To regenerate the file from the trip dataset, re-run the generator against
`london-trip-2026.json`.

## The API

| Method | Path           | Does                                                |
| ------ | -------------- | --------------------------------------------------- |
| GET    | `/api/sights`  | The list plus all current votes, in one round trip   |
| GET    | `/api/votes`   | Votes only — the page polls this every 20 seconds    |
| POST   | `/api/vote`    | `{ sightId, voter, wanted }` → toggles one vote      |

`POST /api/vote` returns the full updated vote map, so the page never has to
re-fetch after a click.

Identity is just the name typed in the box, lowercased. "Anna" and " anna " are
the same person; two actual Annas would collide, so use surnames or nicknames if
that's a risk. There are no accounts and no cookies — this is a tool for four
people who trust each other, not a public poll.

## What this is not

No auth, no rate limiting, no audit trail. Anyone with the URL can vote as
anyone. That's deliberate for a private group; don't reuse it for anything where
that matters.

## Later: the itinerary app

When you're ready for the planning stage, the shape is already here — the votes
table gives you interest scores per sight, and `london-trip-2026.json` carries
the opening days, prices and booking deadlines to schedule against. The obvious
next step is a second page that takes the top-voted sights and lays them onto
the six days, respecting each sight's `openOn` array.
