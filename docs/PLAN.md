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
| 2 | **Accounts** — email-link sign-in, invites, roles, settings | ✅ done 2026-09-25 (password optional, step 9, open) |
| **3** | **The front door** — a real `/`: what this is, how it works, example trips, sign in; then your trips and a new-trip flow | ⬜ next |
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
- [x] **Step 6 — claim your name.** *(2026-09-25)* On first sign-in a sheet
      asks "Who are you on this trip?" with the unclaimed names, or a box for a
      new one; the member row gets the account's `user_id` (migration 011), and
      votes, comments and bookings stay attached through `name_key`. Every
      write is made as the claimed member — `actor()` in the Worker takes the
      identity from the session and ignores the body's `voter`. Not signed in
      is 401, signed in but unclaimed is 403. **The typed name field is gone.**
      Reading is still open to anyone with the link; step 7 closes that.
- [x] **Step 7 — invites and roles.** *(2026-09-25)* `trip_members.role` is
      `owner | editor | viewer` (migration 012; Emily is the London owner). An
      owner invites by email from the Details page, optionally as an existing
      unclaimed name; the link signs the person in and puts them on the trip
      in one step, and works once for seven days. Reads are members-only; a
      stranger sees "This trip is private". Self-claiming a name is gone —
      membership is the owner's decision. Owners cannot be removed and the
      last owner cannot step down. `src/invites.js`.
- [x] **Step 8 — settings.** *(2026-09-25)* The account sheet, on every page:
      display name, language, and **which maps app "Open in Maps" means**.
      Stored on the account (migration 013), so it follows the person between
      devices; "Automatic" keeps the per-device guess. `POST /api/auth/settings`.
      A sheet rather than a page: it is three fields, and it should be one tap
      away from anywhere.
- [ ] **Step 9 — a password, optionally.** Asked for on 2026-09-25. An
      account may set a password on the settings page; the sign-in sheet then
      offers "email me a link" *and* "password". The link stays the way in
      for anyone without one, and is the reset path. Stored with a slow hash
      (PBKDF2 through Web Crypto — no dependency), never the password itself.
      Adds one column to `users`; `sessions` and everything else unchanged.

### Phase 3 — the front door

Rethought on 2026-09-25. Until now `/` redirected to the London trip, and a
signed-out visitor met a private-trip notice — or, worse, the leftover
"access code" prompt. The front page has to stand on its own: say what this
is, show it, and offer the way in.

- [x] **Step 10 — `/` is the front page.** *(2026-09-25)* `public/home.html`.
      Signed out: what the app does, a three-step "how it works" drawn as
      miniatures of the real components (not screenshots — those would show
      the group's names), the example trips once step 11 lands, and Sign in.
      Signed in: your trips first, each with dates, your name and role. The
      redirect from `/` to trip 1 is gone; the other old paths still redirect.
      The shell has a trip-less home mode: no tabs, no private notice, no
      path scoping. `GET /api/trips`. "New trip" comes with step 12.
- [x] **Step 11 — example trips.** *(2026-09-25)* `trips.visibility` =
      `private | public` (migration 014). A public trip can be read by anyone
      at its usual addresses — `reader()` in the Worker — with a thin banner
      and a Sign in; only members can change it, through the unchanged
      `actor()`. The owner switches it on the Details page. The front page
      lists public trips as examples, signed in or out. One is seeded: "A
      weekend in Amsterdam", six places with coordinates checked against
      OpenStreetMap, three placeholder people, votes, a comment or two, one
      booking, a two-day plan and two entries of their own. Trip 2; ids
      prefixed `ams-`. London stays private.
- [ ] **Step 12 — new trip.** From the front page: name, destination, first
      and last day. The creator's account becomes the trip's owner as their
      display name. Optionally start from a template: the London 55 when the
      destination is London, the example's places otherwise. `POST
      /api/trips`, `GET /api/trips` (mine). Small, and it is what makes step
      13 testable: until it exists nobody has two trips.
- [ ] **Step 13 — your trips, organised.** *Settled 2026-09-25; see §7.* Once a person has more than one trip, "Your trips"
      stops being a list and becomes a home:

      - **Now, or next.** One trip at the top, large. If a trip's dates
        include today it is *current*: "Saturday · day 3 of 6", today's stops
        from the plan with their times, Open in Maps and the day's route,
        and a jump to the Plan. Otherwise the nearest future trip is *next*:
        "in 23 days", and what still needs doing — places still to book,
        places with votes that are not on a day yet, open invitations (for
        the owner) — each a link into the right page.
      - **Upcoming.** The other future trips, compact: name, dates, days,
        your role. Trips with no dates yet sit here first, marked "no dates
        yet", because they are the ones being planned.
      - **Past.** Everything whose last day has passed, grouped by year,
        collapsed. Still fully usable — people add notes and photos after a
        trip — just out of the way. Derived from the dates; nothing to
        maintain.
      - **New trip** as a button beside the heading, and the examples only
        for someone with no trips of their own (otherwise a small link).

      Derived from dates and the existing tables, plus two small fields
      settled in §7: a per-person pin (`users.pinned_trip_id`) that puts one
      trip first regardless of dates, and `trips.status` for a cancelled
      trip so one that never happened does not sit in Past as if it did.
- [x] **A way home.** *(2026-09-25, asked for by Emily.)* The bar on every
      trip page has a "‹ Trips" link to the front page (a chevron and a house
      on a phone); the private notice links there too. Before this the brand
      only led to the trip's own Sights page, so someone on the example had
      no way to the page where they could sign in.
- [ ] **Step 14 — leave, delete, cancel.** A member can leave a trip; the
      owner can delete one (everything under it goes; asks twice) or mark it
      cancelled. Drops the two unread tables `trip_settings` and
      `custom_sights` in the same migration.

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
*Superseded 2026-09-25: the front page is Phase 3 step 10; the London links
are on `/t/1/…` and the old page paths keep redirecting.*

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

**2026-09-25 — A password, as an option next to the link.**
Emily asked why there is no password. The link stays the default because the
mailbox already is the proof and there is nothing to leak; but a password is
faster on a device you use every day, and does not depend on mail arriving.
So: optional, set from settings, never required, the link remains the reset
path. Step 9.

**2026-09-25 — The server decides who you are.**
Until now every write carried `voter`, a name the page typed in, and the
server believed it. With accounts, `actor()` resolves the session cookie to
the member that account has claimed on the trip, and that is the name every
write is recorded under. The pages still send `voter` out of habit; it is
ignored. The test harness turns `voter: "Manuel"` into the cookie of an
account that has claimed Manuel, so the four hundred existing checks kept
their meaning without a rewrite.

**2026-09-25 — Claiming is how history carries over.**
Votes, comments, bookings and plan entries are keyed on the lowercased name.
Rather than migrate those keys to user ids, an account claims the member row
and inherits everything under that name — including what was recorded before
accounts existed. One account per name per trip, and a claimed name cannot be
taken by anyone else; the Details page shows a tick on claimed names.

**2026-09-25 — An invite is a sign-in.**
The invitation goes to a mailbox; opening it proves that mailbox, which is
exactly what a sign-in link proves. So the invite link does both: account,
session, membership, role, and it lands on the trip. No "sign in, then find
the invite" dance. It also means the "who are you?" sheet from step 6 went
after one day: with invites, the owner picks which existing name a person
becomes, and nobody can walk in and claim a name.

**2026-09-25 — Three roles, and viewers vote.**
Voting is the point of inviting someone, so `viewer` votes and comments.
`editor` changes places, bookings, addresses and the plan. `owner` changes the
trip itself and its people. Roles include everything below them. A trip must
always have an owner: the last one cannot be demoted or removed.

**2026-09-25 — Preferences live on the account, with "Automatic" as the default.**
Language and the maps app were per-browser guesses. On the account they are
the same on the phone and the laptop, and an explicit choice beats the guess
— but nobody is forced to choose, so an account with nothing set behaves as
before. The account's language is applied on load; the maps choice is read
whenever a link is built.

**2026-09-25 — The shared passphrase is gone.**
`ACCESS_CODE` guarded the whole site before accounts existed, and the shell
answered any 401 with an "Access code" prompt. Once 401 meant "sign in", every
signed-out visitor got that prompt on every page. Removed outright rather than
special-cased: trips are private by membership, which is the stronger guard.

**2026-09-25 — The front door comes before "new trip".**
Superseding the Phase 3 order. A visitor who is not signed in should land on
a page that explains the app and lets them in — not on someone's private
trip. Example trips do the explaining better than prose, so public
(read-only) trips come right after the page itself, and creating a trip
comes after there is a place to create it from.

**2026-09-25 — Public means readable, never writable.**
A public trip needs no new permission model: reads go through `reader()`,
which is `actor()` with one fallback for a public trip, and every write still
goes through `actor()`. So the example can be looked at by the whole world and
changed by nobody who is not on it. The example is seeded as data, not
special-cased in code: it is a trip like any other that happens to be public.

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
- ~~**Passwords.** Magic link only.~~ Reconsidered 2026-09-25: an optional
  password per account, alongside the link — Phase 2 step 9.

---

## 7. Open questions

**Step 13 — your trips, organised** *(settled 2026-09-25)*

- Which trip comes first: **by dates, plus a manual pin.** A trip that
  includes today is current; otherwise the nearest future one is next; a
  pinned trip beats both. The pin is per person, one at most: a small
  `pinned_trip_id` on `users`.
- The top card: **today's plan for a current trip; countdown and to-dos for
  a next one.**
- Past trips: **derived from the end date**, grouped by year, collapsed,
  fully usable.
- Cancelled: **yes**, a `status` on `trips` (`planned | cancelled`), set by
  the owner from Details, shown under Past with a label.
- Trips without dates: top of Upcoming, marked "no dates yet".
- Switching from inside a trip: nothing new; the brand goes home.

