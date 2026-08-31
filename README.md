# London sights — vote and book

Two pages. On **Sights**, everyone types their name, taps **Want this** on what
they'd like to do, and sees everyone else's picks live. On **Bookings**, the
same list filtered down to what costs money or has to be booked ahead, so you
can see what actually needs arranging.

Runs entirely on Cloudflare's free tier: one Worker serves both the page and the
API, and votes live in D1 (Cloudflare's SQLite). No build step, no framework,
no npm dependencies at runtime.

```
public/index.html      the vote page — HTML, CSS and JS in one file
public/bookings.html   the bookings overview
public/plan.html       the day-by-day plan
public/route.js        builds the Google and Apple Maps links
src/worker.js          the API, and the static-file fallthrough
src/sights.js          the 55 sights (generated; edit freely)
schema.sql             six tables
wrangler.toml          config — you paste your database id here
scripts/setup.mjs      one-time: creates the database, fills in wrangler.toml
scripts/fetch-geo.mjs      fills in coordinates from Wikipedia
scripts/fetch-images.mjs   optional: self-host the photos
scripts/migrate-bookings.sql  one-off: adds the Bookings columns to an
                              existing database
scripts/migrate-plan-notes.sql  one-off: adds your own plan entries
```

## The Bookings page

`/bookings`, linked from the bar at the top of every page. It shows everything
that **costs money or has to be booked ahead** — not simply everything paid,
because Sky Garden, Horizon 22 and the Barbican Conservatory are free and still
need a slot reserved.

- **Filters** by vote count and by kind (built-in, added by us, booking-only).
  Each button carries its own count, so you can see what a filter will do before
  pressing it.

  The preset buttons stop at the highest vote count anyone has actually reached,
  since buttons above that would all show the same thing. Next to them is a box
  you can **type any threshold into** — useful once the group is larger than the
  presets go, or when you want to jump straight to "6+" without clicking
  through.
- **Sorted by votes**, most wanted first, with who voted for each one.
Every entry sits in one of three lists, and moving between them never touches
the sight itself — it stays on the voting page with every vote intact.

- **Still to book** — the main list, with the filters above it.
- **Booked** — press **"Mark as booked"** and the card asks for the slot you
  actually hold: a date and, if there is one, a time. Both optional, since
  plenty of things are booked for a day rather than an hour. It then moves down
  to its own list showing the slot, the price and who booked it. **"Change
  slot"** edits it; **"Not booked after all"** puts it back.
- **Not booking these** — **"Not booking this"** for anything you have decided
  against. Collapsed at the bottom with who removed it, one click to restore.

The filters apply to the main list only. A booked entry is done, and hiding one
behind a vote filter would just make people wonder whether it really got booked.

## The Plan page

`/plan`, a column per day of the trip. It has no scheduler in it — no routes, no
travel times, nothing worked out for you. It shows what happens when, and the
times are the ones you type.

Entries come from two places:

- **Booked with a date** — anything marked booked on the Bookings page with a
  slot appears here on its own. Change the slot there and the plan follows.
- **Added by hand** — everything else, free or not. The quickest way is
  **"Add to a day"** on the sight's own card over on Sights: pick a day and
  optionally a from and to time. The Plan page has the same thing in a dropdown
  if you would rather work from there. Only the day is required; plenty of
  things are "Tuesday, sometime", and those sort to the end of their day.

  A card already on the plan shows when, and offers **Change** or **Take off the
  plan**. One placed by its booking says so and points at the Bookings page,
  since its slot belongs there.
- **Your own entries** — anything that isn't one of the sights at all: a musical
  you already booked, dinner with friends, the train home. Type a name, pick a
  day, add times if there are any. Anyone can remove one.

Each stop is labelled **booked**, **by hand** or **yours** so it is obvious
which is which, and the last two can be taken off again.

### Routes

Every day with somewhere to go carries **Route · Google** and **Route · Apple**
links covering the whole day in order.

Neither URL includes a starting point, so both apps begin from wherever your
phone is. That is right when you are standing in London, and it means there is
no "where are we starting from" to configure.

**Already done the first two stops?** Every stop from the second onward has a
**Route from here** link covering that stop and the rest of the day. No ticking
things off, nothing to keep in sync between four phones — you just tap the one
you are heading to next.

Stops with no location — your own entries, and added sights, which have no
coordinates yet — are left out of the route and the day says how many. They are
never sent as a text guess, which can fail the whole route.

The same filters sit above the days: a vote threshold (preset buttons plus a box
for any number) and a source filter for **Bookings** or **By hand**. These only
change what is shown — a line under the days says how many stops the filters are
hiding, so a filtered plan never looks like an empty one.

A sight can't be on the plan twice. If you book something that was already
placed by hand, the booking takes over and the hand entry goes; the API refuses
a hand entry for anything already booked with a date.

### Sights you add yourself

The "Add a sight" form asks whether it **costs something** (with an optional
price) and whether it **needs booking ahead**. Either one puts it on the
Bookings page alongside the built-ins. Neither is required — a free viewpoint
just never appears there.

Nobody always knows those two things when they add something, so both are
editable afterwards: **Cost & booking** on an added card opens the same fields
inline. **Anyone can change them**, not only whoever added the sight — the
person who knows a tour has to be booked is often not the person who added it.
Removing a sight is still limited to whoever added it.

## Deploy (about five minutes)

You need a free Cloudflare account and Node 18+.

There is nothing to install. Every script calls `npx wrangler@4`, which runs
from npm's cache outside this folder — so no `node_modules/`, and nothing large
ever lands in your repo.

```bash
npm run login     # opens a browser once
npm run setup     # creates the D1 database, writes its id into wrangler.toml,
                  # and creates the votes table
npm run deploy    # ships it
```

`npm run setup` is safe to re-run — it reuses an existing database rather than
making a second one.

Upgrading a database that predates the Bookings page needs the one-off column
migration, because `CREATE TABLE IF NOT EXISTS` can't alter a table that already
exists:

```bash
npx wrangler@4 d1 execute london-votes --remote --file=./scripts/migrate-bookings.sql
npx wrangler@4 d1 execute london-votes --remote --file=./scripts/migrate-plan-notes.sql
```

Wrangler prints the URL — something like
`https://london-sights-vote.<your-subdomain>.workers.dev`. Send that to the
group. That's the whole thing.

### "binding DB of type d1 must have a valid `database_id`"

`wrangler.toml` still says `PASTE_YOUR_DATABASE_ID_HERE`. Run `npm run setup` to
fill it in, **then commit and push it** — if Cloudflare builds from your GitHub
repo, it reads `wrangler.toml` from the repo, so an id that only exists on your
laptop won't help:

```bash
npm run setup
git add wrangler.toml && git commit -m "Add D1 database id" && git push
```

To do it by hand instead: Cloudflare dashboard → **Storage & Databases → D1 →
Create**, name it `london-votes`, copy the ID from its page into
`wrangler.toml`, then `npm run db:remote` to create the table.

The database id is not a secret — it's an identifier scoped to your account, and
it has to be in the repo for the build to work.

### "Worker name doesn't match"

If you connected a GitHub repo, the Worker is named after what you created in
the dashboard — yours is `travel-webapp`. Change the `name` line in
`wrangler.toml` to match it, or the deploy targets the wrong script.

> **Do not run `npm install`.** There are no dependencies. If you ever install
> wrangler locally, `node_modules/` will contain a ~135 MB `workerd` binary that
> GitHub refuses to accept — `.gitignore` covers it, but make sure that file is
> at your repository root.

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
npx --yes wrangler@4 secret put ACCESS_CODE     # type the passphrase when prompted
```

The page then asks for it once and remembers it. Remove it with
`npx --yes wrangler@4 secret delete ACCESS_CODE`.

## Photos

By default the page asks Wikipedia for a lead photo for every built-in option in
one batched request on first load, then caches the URLs in the visitor's browser
for 30 days. Anything the batch misses is retried individually against the REST
summary endpoint. If a photo still can't be found the card shows a lettered
placeholder — the page works fine either way.

If you see only placeholders, open the console: the usual causes are an
extension blocking `en.wikipedia.org`, or a stale cache. Clear it by running
`localStorage.removeItem("london-vote-images-v2")` and reloading.

To self-host them instead:

```bash
npm run images       # downloads into public/img/ + writes CREDITS.json
```

## Tests

```bash
npm test
```

177 checks against a SQLite-backed mock of the Worker — voting, un-voting,
duplicate names, adding and removing options, URL sanitising, the access code,
and the bookings list: what belongs on it, the cost fields on added sights, and
moving entries between still-to-book, booked and not-booking without touching
their votes, the date and time of a booked slot, the plan (placing a sight by
hand, a booking taking over from a hand entry, and the rules that keep one sight
from appearing twice), and the maps routes. No network and no Cloudflare account
needed.

Most Wikimedia images are CC-licensed and need attribution. `CREDITS.json`
records the source page for each one — check the licence before using any of
these outside a private group.

## Putting it on GitHub

The repo only ever needs these ten files — it should be well under 100 KB.

```bash
git init
git add .
git commit -m "London sights vote app"
git branch -M main
git remote add origin git@github.com:YOU/travel-webapp.git
git push -u origin main
```

GitHub is only storing the source here; Cloudflare does the hosting. If you'd
rather push-to-deploy, connect the repo under **Workers & Pages → your Worker →
Settings → Builds** in the Cloudflare dashboard, and every push to `main`
deploys itself.

## What's on the page

55 options, ranked — the famous ones (British Museum, Big Ben, Changing of the
Guard, the London Eye, the Shard) alongside the local ones, plus the free Harry
Potter stops (Platform 9¾, House of MinaLima, Millennium Bridge, St Pancras) and
Ranger's House, the Bridgerton exterior.

**Language.** EN/DE toggle in the header bar. Every option carries German text
(`name_de`, `summary_de`, `priceLabel_de`) and the whole interface switches with
it. It defaults to German if the browser's language is German, and remembers the
choice.

**Adding your own.** "Add a sight" at the top of the list: name is required,
link and description optional. Whoever adds one is counted as its first vote and
is the only person who can remove it again. Added entries appear in the list with
a dashed border and an "Added" badge, and everyone can vote on them.

**Photos.** The page fetches a lead image for each built-in option from
Wikipedia in one batched request, then caches the URLs for 30 days. Added
entries get a plain coloured strip instead — no photo needed.

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
  bookingRequired: true,      // shows on /bookings even when it is free
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
| GET    | `/api/state`   | Votes + added options — polled every 20 seconds      |
| POST   | `/api/vote`    | `{ sightId, voter, wanted }` → toggles one vote      |
| POST   | `/api/sights/add`    | `{ voter, name, url?, summary? }` → adds an option |
| POST   | `/api/sights/edit`   | `{ voter, id, costs, bookingRequired, priceLabel? }` → anyone |
| POST   | `/api/sights/remove` | `{ voter, id }` → creator-only delete              |
| POST   | `/api/bookings/status` | `{ voter, sightId, status, bookedDate?, bookedTime?, bookedEnd? }` → `"booked"`, `"skipped"` or `null` |
| POST   | `/api/plan/set`      | `{ voter, sightId, day, start?, end? }` → onto the plan |
| POST   | `/api/plan/remove`   | `{ voter, sightId }` → off it again                |
| POST   | `/api/plan/note/add` | `{ voter, label, day, start?, end? }` → your own entry |
| POST   | `/api/plan/note/remove` | `{ voter, id }` → remove one                    |

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
