# Plan & decision log

Living document. Tick the status boxes as work lands, and **append** to the
decision log rather than rewriting it.

Last updated: 2026-09-25

---

## 1. Where this is going

A **trip builder** anyone can use. One person creates a trip and invites the
people coming; everyone invited gets access, and edit rights where the owner
grants them. The group adds places, votes on them, books what needs booking,
and lays the result onto the days of the trip with maps routes for each day.

We do **not** author itineraries for cities. Users build their own. London was
the first trip — a real one, 11–16 September 2026, for four people — and it is
now the migration test case, not the product. Its four names (Emily, Manuel,
Maya, Roswitha) become the first four accounts.

### The inversion that defines the refactor

| | Today | Target |
| --- | --- | --- |
| Built-in places | hardcoded array in `src/sights.js` | rows in the database, imported once as the first trip's items |
| User-added places | `custom_sights` (the exception) | **the normal case** — one `items` table |
| Trip | one row, `trip_settings` `id = 1` | many rows, each with an owner and members |
| Identity | a typed name, lowercased | an account, signed in by email link |
| Access | anyone with the URL | members of the trip; roles decide who may edit |

`custom_sights` is already the shape we need. Generalising is mostly *deleting
the special case* — routing built-ins through the same table — not inventing a
new model.

---

## 2. What exists today (main, September 2026)

Four pages on one Cloudflare Worker with D1, no build step:

| Path | Page | What it does |
| --- | --- | --- |
| `/details` | Details | the trip: name, destination, dates, where we stay, travel, who is coming, notes |
| `/` | Sights | the 55 built-ins plus added places; votes, comments, "add to a day" |
| `/bookings` | Bookings | what costs money or needs booking; still to book / booked / not booking |
| `/plan` | Plan | a column per day; stops placed by hand or by a booking; maps routes; a detail sheet |

The plan is **placed by hand**. There is no scheduler on main; the automatic
day planner that was built on `feature/day-planner` was not merged (see the
decision log, 2026-09). Bookings with a date place themselves; everything else
you drag onto a day yourself, and the app never rearranges what you did.

Design: one shared stylesheet (`public/app.css`) and shell (`public/shell.js`),
Apple-like, with a colour concept where every hue means one thing. See the
README's "The design" section.

Identity is still a typed name. That is the thing Phase 2 replaces.

---

## 3. Roadmap

| Phase | What | Status |
| --- | --- | --- |
| 0 | The London trip on the current stack: vote, book, plan by hand | ✅ done, trip travelled |
| 0.5 | Redesign on a shared design system; nothing London-specific in the pages | ✅ done 2026-09-11 |
| 1 | **Trips and items in the database** — `trips`, `items`, `trip_id` on everything | ✅ done 2026-09-25 |
| **2** | **Accounts** — email-link sign-in, members linked to accounts, invites, roles, settings (maps app, language) | ⬜ next |
| 3 | Create your own trip: trip list, new-trip flow, the London 55 as an optional template | ⬜ |
| 4 | Public hardening: rate limiting, abuse handling, geocoding cache, server-side image cache | ⬜ |

Phases 1 and 2 are cut into steps small enough to ship one at a time against
the live database, each with a migration and a test.

### Phase 1 — trips and items

- [x] **Step 1 — `trips` exists.** *(2026-09-18)* A `trips` table; `trip_settings`
      row 1 became trip 1. Every table has a `trip_id` defaulting to 1, and the
      two keys that were global (a member's name, a journey's direction) are
      per trip. Every query is scoped; `tripOf()` answers 1 until step 3. No UI
      change. Migration 007. `trip_settings` is left in place, unread, until a
      later migration drops it.
- [x] **Step 2 — one `items` table.** *(2026-09-24)* Built-ins and added places
      are rows in `items` with a `source` column. Migration 008 creates the
      table and copies `custom_sights`; migration 009, generated from
      `src/sights.js` by `scripts/build-items-seed.mjs`, imports the London 55
      keeping their ids, so **no vote was lost**. The worker no longer imports
      `sights.js`; the API's shape is unchanged, so no page changed.
      `custom_sights` stays in place, unread, like `trip_settings`.
- [x] **Step 3 — the API is trip-scoped.** *(2026-09-25)* Every endpoint takes
      the trip from the URL: `/api/t/<trip>/…`. The old paths are aliases for
      trip 1 until the pages move. A trip that does not exist, or is not a
      number, is a 404. No migration.
- [x] **Step 4 — the pages are trip-scoped.** *(2026-09-25)* `/t/<trip>/`,
      `/t/<trip>/plan`, `/bookings`, `/details`. The old addresses redirect to
      trip 1, so the London links keep working. The shell reads the trip from
      the address and puts it into every API call, so no page changed. The
      Worker sees every request now (`run_worker_first`) and serves the four
      HTML files itself; an unknown trip gets a small 404 page. No migration.

### Phase 2 — accounts

- [x] **Step 5 — sign in.** *(2026-09-25)* `users`, `login_tokens`, `sessions`
      (migration 010). A link by email, no passwords; the link works once and
      lasts fifteen minutes, the session thirty days. Mail goes through Resend
      (`RESEND_API_KEY` secret, `MAIL_FROM` var); with no key set the link is
      returned in the response, which is how development and the tests walk
      the flow. `src/auth.js`; a Sign in button and sheet in the shell. Nothing
      about a trip changes yet.
- [ ] **Step 6 — claim your name.** On first sign-in, pick which existing
      member you are; that member row gets your `user_id`, and votes, comments
      and bookings stay attached through `name_key`. The four London names are
      claimed once and the typed-name field disappears.
- [ ] **Step 7 — invites and roles.** `members (trip_id, user_id, role)` with
      `owner | editor | viewer`. The owner invites by email; the invite is a
      link that signs the person in and adds them. The API checks membership on
      every trip-scoped call and the role on every write.
- [ ] **Step 8 — settings.** An account page: display name, language, and
      **which maps app "Open in Maps" means** (Apple or Google). The setting
      replaces the per-device guess in `shell.js`, which stays as the default
      for anyone who has not chosen.

### Phase 3 — your own trip

- [ ] A trip list at `/`, a "new trip" flow, the London list offered as a
      template when the destination is London, and a landing page for people
      who are not signed in.

### Phase 4 — public hardening

- [ ] Rate limits on writes and on geocoding; geocoder results cached in KV;
      photos cached server-side; abuse reporting; a privacy note.

---

## 4. Migration rules

The remote database holds real data. Every schema change is a numbered
`scripts/migrate-NNN-*.sql`, applied by `npm run migrate` locally first and by
`npm run migrate:remote` only when asked. A migration must:

- be additive (new tables, new columns with defaults) or copy data before it
  drops anything;
- keep every existing id — sight ids are the vote key;
- leave the app working between the migration and the deploy that uses it.

---

## 5. Decision log

Append; don't rewrite.

**2026-08-25 — Planning logic stays destination-agnostic.**
Map-link building and anything that reasons about places is a pure function
over `{lat, lon, …}`. Phase 1 changes where items come from, not the engine.

**2026-08-25 — Booking is a tracker, not an integration.**
Deep links plus status tracking. Affiliate ticket APIs are a later monetisation
question, not a planning feature. In-app payment is not happening.

**2026-08-25 — Stack: stay on Worker + D1, no build step.**
Plain HTML/JS pages with one shared stylesheet and shell module. A framework is
reconsidered at the Phase 3 boundary, when there are trip-list, sign-in and
settings views; not before.

**2026-08-25 — Auth will be magic-link email.**
Cloudflare Access is for private orgs, not public signup. Passwordless keeps us
out of password storage entirely.

**2026-08-25 — No landing page yet; the vote page keeps `/`.**
The group has the `/` link. A landing page belongs with signup (Phase 3).

**2026-08-27 — The route origin is personal; the trip's base is shared.**
Where a day starts for *the group* (the hotel) is a trip setting. Where a route
starts for *you* (hotel, your position, or nothing) is your device's choice and
lives in `localStorage`. Two questions that look like one.

**2026-08-27 — Not everything has a location, and that is not an error state.**
A tour or a day pass has no address. Such a stop sits on the day it was given
and is left out of the route; the row says "no address yet" rather than failing.

**2026-08-27 — A pasted maps link is the escape hatch for geocoding.**
The one search box takes a name, an address, a Google/Apple Maps link or raw
coordinates (`src/maplink.js`). The share sheet on a phone gives you a link and
nothing else.

**2026-09 — The plan is placed by hand; the automatic scheduler was not merged.**
`feature/day-planner` carries a complete deterministic scheduler (clustering,
day assignment, ordering, travel-time estimates). Main went the other way: a
column per day, stops placed by people, a booking with a date placing itself.
The reason is trust — the group wanted to see exactly what they decided, with
nothing moving underneath them. The scheduler stays on its branch as a possible
later "suggest a day" feature, additive and never automatic.

**2026-09-11 — One design system, nothing London in the chrome.**
All pages share `app.css` and `shell.js`. System font, one blue for actions,
green = done/free, amber = money, coral = needs attention, violet = added by the
group, red = destructive. The bar shows the trip's own name. Storage keys became
generic, with a one-time read of the old ones.

**2026-09-18 — "Open in Maps" means the maps app you prefer.**
Plan rows offer *Open in Maps* for the place; the route on from a stop through
the rest of the day moved into the stop's sheet. Which app opens is a
preference: Apple on Apple devices, Google elsewhere, overridable per browser
today and a per-account setting in Phase 2 (`shell.js` `mapsApp()`).

**2026-09-18 — Access is by membership; the owner invites.**
One account creates a trip and owns it. The owner invites others by email; an
invited person gets access to that trip and a role (`owner`, `editor`,
`viewer`) that decides what they may change. Nobody sees a trip they were not
invited to. The London trip's four voters become its first four members by
claiming their names at first sign-in, so nothing they voted or booked is lost.

**2026-09-18 — Migrations run once, and the database remembers which.**
The runner used to replay every file on every run, relying on "duplicate
column" errors to skip work. That made a migration that rebuilds a table
unsafe to keep around, and 007 has to rebuild two. `schema_migrations` now
records each file; a fresh `schema.sql` pre-records all of them, and an older
database is read from its own shape (a table or column that only a given file
creates) and recorded without replaying — replaying 006 re-added a member who
had been taken off the list. If the table cannot be read, the runner stops
before touching anything.

**2026-09-18 — Ids stay global; `trip_id` rides alongside.**
Place, comment and entry ids are uuids (or the London built-in ids, which
belong to trip 1), so tables keyed on them keep their one-column keys and get
`trip_id` as a column rather than part of the key. Only the two keys that were
genuinely per trip — member name, journey direction — were rebuilt. Less
churn, and the vote key — the thing that must never change — is untouched.

**2026-09-24 — The template is imported, not read.**
The London places could have stayed in `sights.js` with the database holding
only what the group added. They are rows now because the product is a builder:
a trip's places are the trip's data, editable in the app one day, and nothing
about London belongs in the Worker. `sights.js` remains as the seed a fresh
database gets and as a future "London" template. Consequence: editing the file
no longer changes the live trip; the rows do.

**2026-09-24 — One API shape, two sources.**
`/api/sights` still answers `sights` (built-ins) and `custom` (added), read
from the same table by `source`. Keeping the wire format let the storage move
without touching a page; merging the two card designs is a UI decision for
later and should not be forced by a schema change.

**2026-09-24 — Migrations are split by a real SQL walk.**
The runner split files on every semicolon and stripped everything after `--`,
which would have cut a place's summary in half. `scripts/sql-split.mjs` walks
the text and honours string literals and comments; the runner and the test
harness both use it.

**2026-09-25 — Trips live under a path, not a subdomain.**
`/api/t/<id>/…` now, `/t/<id>/plan` for the pages in step 4. A path needs no
DNS, no wildcard certificate and no per-trip configuration, and the id is a
number rather than a name so nothing has to be unique or URL-safe. The
un-prefixed paths stay as aliases for trip 1 while the London links are in use.
A trip that does not exist is a 404 that says so, never an empty trip.

**2026-09-25 — `/` redirects to trip 1; the trip list will take it over.**
Supersedes "the vote page keeps `/`" (2026-08-25). The London group's links
still work because every old address redirects to its `/t/1/…` twin, which is
all that decision was protecting. When Phase 3 puts a trip list at `/`, the
redirect goes and the list takes its place; the London links are already on
their permanent addresses.

**2026-09-25 — The Worker serves the pages; the same four files serve every trip.**
Rather than one copy of the pages per trip, the Worker maps `/t/<id>/plan` to
`plan.html` and the shell reads the id from the address. That kept step 4 to a
routing change: the pages did not need to know they had moved. It also means
the Worker now runs for every request, which was the price of being able to
redirect the old addresses at all.

**2026-09-25 — Sign-in mail goes through Resend.**
Cloudflare's own email sending needs a domain set up in Cloudflare; Resend
needs an API key and, to reach anyone but the account owner, a verified
domain — but it works today with the test sender, has a free tier, and is one
HTTP call. The sender is one function (`sendMail` in `src/auth.js`), so
swapping it later is contained.

**2026-09-25 — Tokens and sessions are stored as hashes; the link in the mail is the secret.**
A copy of the database cannot sign anyone in. A request for a link always
answers the same way whether or not mail went out, and stops sending after
five an hour per address, so the endpoint confirms nothing about who has an
account. `next` is kept only if it is a path on this site.

**2026-09-18 — Phase 1 before Phase 2.**
Accounts, invites and per-account settings all hang off a user row *and* a
membership row, and membership is per trip. Doing trips and items first means
the account work is done once, against the final model, instead of once for a
single trip and again for many.

---

## 6. Out of scope (deliberately)

Recorded so these get reconsidered on purpose, not stumbled into.

- **Automatic day planning.** On `feature/day-planner`, unmerged. Possible later
  as an optional suggestion, never as something that rearranges a plan by itself.
- **LLM-generated plans.** Rejected as the engine. A later additive "review my
  plan" pass (pacing, food stops, a blurb per day) would be fine because it
  cannot change the schedule.
- **Ticket sales / affiliate booking APIs.** Phase 4 at the earliest.
- **Geocoding at public scale.** Nominatim allows about one request a second.
  Fine for a group; a public product needs a cache and probably a paid geocoder.
- **Per-row translations for user content.** `name_de` / `summary_de` exist
  only because the London 55 were authored. User content is one language; i18n
  stays for UI chrome.
- **Passwords.** Magic link only.

---

## 7. Open questions

- Should a `viewer` be able to vote? (Leaning: yes — voting is the point of
  inviting someone; `editor` adds places, bookings and plan changes; `owner`
  edits the trip itself and members.)
