# CLAUDE.md

Orientation for anyone — human or AI — picking this project up.
**Read `docs/PLAN.md` before making changes.** It holds the roadmap, the
decision log, and what is deliberately out of scope.

## What this is

A trip-planning web app. Today it serves one trip (London, September 2026, now
travelled); it is becoming a **trip builder** where one account creates a trip,
invites the people coming, and the group votes on places, tracks bookings and
lays out the days by hand. The product is a *builder*: we do not author
itineraries for cities. The London list is content, not the app's spine.

## Stack

Cloudflare Worker + D1. No build step, no runtime dependencies, no framework.

```
public/details.html   Details   /t/<trip>/details   the trip itself
public/index.html     Sights    /t/<trip>/          vote, comment, add places, put one on a day
public/bookings.html  Bookings  /t/<trip>/bookings  still to book / booked / not booking
public/plan.html      Plan      /t/<trip>/plan      a column per day, maps routes, a detail sheet
                      (the Worker maps these to the files; /, /plan… redirect to trip 1)
public/app.css        the design system: tokens, colour concept, components
public/shell.js       the shared shell: nav + tab bar, sign-in and claim sheets, language, toast, api(), maps preference
public/route.js       Google / Apple Maps links for a day or a stop
src/worker.js         the API, page routing, and the static-asset fallthrough
src/auth.js           sign-in by email link: tokens, sessions, the /auth callback, Resend
src/invites.js        invites: create, list, revoke, and the /invite link that joins a trip
src/http.js           json() and bad()
src/sights.js         the London template; scripts/build-items-seed.mjs turns it into migration 009
                      (places live in the `items` table — this file is not read at runtime)
src/maplink.js        coordinates out of a pasted maps link
schema.sql            fresh-install schema; existing databases get scripts/migrate-*.sql
scripts/migrate.mjs   applies every migration, skipping done ones
scripts/test.mjs      the test suite: a SQLite mock of D1, no network
```

## Commands

```bash
npm run dev             # local, http://localhost:8787 (uses .wrangler/state, a local D1)
npm test                # 277 checks against the Worker with an in-memory SQLite
npm run migrate         # apply migrations to the local D1
npm run migrate:remote  # …to the live one — only when asked
npm run deploy          # only when asked — a push to main does NOT deploy
npx wrangler secret put RESEND_API_KEY   # once; sign-in mail. Unset locally = link returned, not mailed
```

## API

All JSON, under `/api/t/<trip>/…`; the pages call the bare paths below and
`api()` in `shell.js` puts the trip in. The bare `/api/…` paths still answer
for trip 1. An unknown trip is a 404.

**Identity comes from the session cookie.** Every call is made as the member
the signed-in account is on that trip (`actor(request, env, trip, need)` in
`worker.js`); `voter` in a body is ignored. Not signed in → 401; not on the
trip → 403; role too low → 403. Roles: `viewer` reads, votes, comments;
`editor` also places, bookings, plan, addresses; `owner` also the trip, its
people, invites. Reads are members-only.

| Method | Path | Does |
| --- | --- | --- |
| GET | `/api/sights` | everything: sights + the snapshot below |
| GET | `/api/state` | the snapshot: custom, votes, comments, bookings, plan, notes, trip, members, travel |
| POST | `/api/vote` | toggle one vote |
| POST | `/api/sights/add` · `/edit` · `/remove` · `/address` | added places |
| POST | `/api/comments/add` · `/remove` | comments on a place |
| POST | `/api/bookings/status` | booked / skipped / clear, with an optional date and times |
| POST | `/api/plan/set` · `/remove` | put a place on a day, take it off |
| POST | `/api/plan/note/add` · `/update` · `/remove` · `/address` | your own entries |
| POST | `/api/trip/settings` · `/base` · `/travel` · `/member/add` · `/member/remove` | the trip |
| POST | `/api/geocode` | name, address, maps link or coordinates → places |
| GET | `/api/t/<trip>/me` | `{ user, member, trip }` — who you are here; open to anyone |
| POST | `/api/t/<trip>/invite` | owner: `{ email, role?, memberId? \| name?, lang? }` → mails an invite link |
| GET | `/api/t/<trip>/invites` | owner: the open invites (also on `/api/sights` for owners) |
| POST | `/api/t/<trip>/invite/revoke` | owner: `{ id }` |
| GET | `/invite?token=…` | the link: signs in, joins the trip with the role, lands on it |
| POST | `/api/t/<trip>/trip/member/role` | owner: `{ id, role }` |
| POST | `/api/auth/request` | `{ email, next?, lang? }` → a sign-in link by mail (not trip-scoped) |
| GET | `/auth?token=…` | the link: starts a session, sets the cookie, redirects to `next` |
| GET | `/api/auth/me` | `{ user }` or `{ user: null }` |
| POST | `/api/auth/logout` | ends the session |

Every write returns the full snapshot, so a page never re-fetches after a click.

## Conventions

- **No build step, no runtime dependencies.** Plain HTML pages import
  `/shell.js` and link `/app.css`. New UI uses the classes in `app.css` before
  inventing page-specific ones; a colour must mean what the colour concept says.
- **Never deploy or touch the remote database unprompted.** No build is
  connected to the repo, so a push to `main` changes nothing live; only
  `npm run deploy` does, and it, `npm run migrate:remote` and `npm run db:remote`
  run only when asked. Live: https://travel-webapp.emily-gombocz.workers.dev
- **Commits in Emily's name only.** No co-author trailers.
- **Schema changes are numbered migrations** in `scripts/`, additive, applied
  locally first. `CREATE TABLE IF NOT EXISTS` cannot add a column.
- **Place ids are the vote key.** Changing an id resets that row's votes. Places
  are rows in `items` (`source` = builtin | added); nothing reads `sights.js` live.
- **Bind D1 parameters by number.** `?1`, `?2` are positional *by number*.
  Keep them ascending anyway.
- **A place may have no location.** `hasPlace()` guards every route.
- **Never ship an unverified external link or coordinate.** Check the content,
  not the status code.
- **Nothing trip-specific in the pages.** The bar shows `trip.name`; dates and
  destination come from the trip record; text is generic.
- **New logic gets a test in `scripts/test.mjs`.** No network, no account.
- **Update `docs/PLAN.md` as part of the work**: tick the box, append to the
  decision log with the reasoning, record rejected options under "Out of scope".

## Current phase

Phase 0, the redesign and Phase 1 (trips and items in the database, pages and
API under `/t/<trip>/`) are done. **Next is Phase 2** — accounts, invites and
roles. Steps and status live in `docs/PLAN.md` §3.
