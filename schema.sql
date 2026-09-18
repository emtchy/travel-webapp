-- The schema for a fresh database. An existing database is brought to the same
-- shape by scripts/migrate-NNN-*.sql (run `npm run migrate`); the two must
-- agree, so a change here is always paired with a migration there.
--
-- Everything belongs to a trip. Ids of places, comments and entries are unique
-- across trips (uuids, or the built-in ids that belong to trip 1), so tables
-- keyed on them keep their single-column keys and carry trip_id alongside.

-- One trip: what it is, when, and where the days start.
CREATE TABLE IF NOT EXISTS trips (
  id            INTEGER PRIMARY KEY,
  name          TEXT,
  destination   TEXT,
  start_date    TEXT,               -- YYYY-MM-DD
  end_date      TEXT,
  base_name     TEXT,               -- where we are staying
  base_lat      REAL,
  base_lon      REAL,
  base_checkin  TEXT,               -- HH:MM
  base_checkout TEXT,
  base_ref      TEXT,
  base_phone    TEXT,
  near_lat      REAL,               -- bias for address lookups
  near_lon      REAL,
  notes         TEXT,
  set_by        TEXT,
  updated_at    INTEGER,
  created_at    INTEGER NOT NULL DEFAULT 0
);

-- One row per (sight, voter). Toggling a vote off deletes the row.
-- sight_id is either a built-in id from src/sights.js or a "custom-…" id.
CREATE TABLE IF NOT EXISTS votes (
  sight_id   TEXT    NOT NULL,
  voter_key  TEXT    NOT NULL,   -- lowercased name, the identity
  voter_name TEXT    NOT NULL,   -- as typed, for display
  created_at INTEGER NOT NULL,   -- epoch ms
  trip_id    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (sight_id, voter_key)
);

CREATE INDEX IF NOT EXISTS idx_votes_sight ON votes (sight_id);
CREATE INDEX IF NOT EXISTS idx_votes_voter ON votes (voter_key);
CREATE INDEX IF NOT EXISTS idx_votes_trip  ON votes (trip_id);

-- Sights people add themselves. Name is required, link and description optional.
CREATE TABLE IF NOT EXISTS custom_sights (
  id           TEXT    PRIMARY KEY,   -- "custom-<uuid>"
  name         TEXT    NOT NULL,
  summary      TEXT,
  url          TEXT,
  added_by     TEXT    NOT NULL,      -- as typed
  added_by_key TEXT    NOT NULL,      -- lowercased; only they can remove it
  created_at   INTEGER NOT NULL,
  -- Whether it belongs on the Bookings page. Built-in sights answer this from
  -- their `cost` and `bookingRequired` fields; added ones have to be asked.
  costs            INTEGER NOT NULL DEFAULT 0,
  price_label      TEXT,
  booking_required INTEGER NOT NULL DEFAULT 0,
  -- Filled in later, from the plan page. Without lat and lon an added sight is
  -- simply left out of a day's route.
  address          TEXT,
  lat              REAL,
  lon              REAL,
  trip_id          INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_custom_created ON custom_sights (created_at);
CREATE INDEX IF NOT EXISTS idx_custom_trip    ON custom_sights (trip_id, created_at);

-- Comments on an option. Anyone can write, only the author can delete.
CREATE TABLE IF NOT EXISTS comments (
  id         TEXT    PRIMARY KEY,   -- "c-<uuid>"
  sight_id   TEXT    NOT NULL,      -- built-in id or "custom-…"
  author     TEXT    NOT NULL,      -- as typed
  author_key TEXT    NOT NULL,      -- lowercased
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  trip_id    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_comments_sight ON comments (sight_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_trip  ON comments (trip_id, created_at);

-- Where a sight stands on the Bookings page. One row only while it is not
-- simply waiting to be booked, so the common case stores nothing.
--   'booked'  we have it — moves to its own list
--   'skipped' we decided against booking it — moves to the removed list
-- Either way the sight stays in the vote list and keeps every vote.
CREATE TABLE IF NOT EXISTS booking_status (
  sight_id    TEXT    PRIMARY KEY,  -- built-in id or "custom-…"
  status      TEXT    NOT NULL CHECK (status IN ('booked', 'skipped')),
  marked_by   TEXT    NOT NULL,     -- as typed
  booked_date TEXT,                 -- YYYY-MM-DD, the slot we actually hold
  booked_time TEXT,                 -- HH:MM, when it starts
  booked_end  TEXT,                 -- HH:MM, when we expect to be done
  created_at  INTEGER NOT NULL,
  trip_id     INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_booking_trip ON booking_status (trip_id);

-- Sights put on the plan by hand — the ones with nothing to book, so nothing
-- else would ever place them. Booked sights come from booking_status instead
-- and never need a row here.
CREATE TABLE IF NOT EXISTS plan_entries (
  sight_id   TEXT    PRIMARY KEY,   -- built-in id or "custom-…"
  day        TEXT    NOT NULL,      -- YYYY-MM-DD
  start_time TEXT,                  -- HH:MM
  end_time   TEXT,                  -- HH:MM
  added_by   TEXT    NOT NULL,      -- as typed
  created_at INTEGER NOT NULL,
  trip_id    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_plan_day  ON plan_entries (day, start_time);
CREATE INDEX IF NOT EXISTS idx_plan_trip ON plan_entries (trip_id, day, start_time);

-- Anything on the plan that isn't one of the sights: a musical already booked,
-- meeting friends, a train. Kept apart from plan_entries because that table
-- is keyed on a sight and these have none.
CREATE TABLE IF NOT EXISTS plan_notes (
  id         TEXT    PRIMARY KEY,   -- "note-<uuid>"
  day        TEXT    NOT NULL,      -- YYYY-MM-DD
  start_time TEXT,                  -- HH:MM
  end_time   TEXT,                  -- HH:MM
  label      TEXT    NOT NULL,
  added_by   TEXT    NOT NULL,      -- as typed
  created_at INTEGER NOT NULL,
  -- Same as an added sight: without a location it is simply left out of the
  -- day's route. Dinner at a named place is worth routing to.
  address    TEXT,
  lat        REAL,
  lon        REAL,
  trip_id    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_notes_day  ON plan_notes (day, start_time);
CREATE INDEX IF NOT EXISTS idx_notes_trip ON plan_notes (trip_id, day, start_time);

-- Who is coming. name_key is the lowercased name, the same identity a vote
-- uses, so a member and their votes line up. Unique per trip, not per world.
CREATE TABLE IF NOT EXISTS trip_members (
  id         TEXT    PRIMARY KEY,   -- "m-<uuid>"
  trip_id    INTEGER NOT NULL DEFAULT 1,
  name       TEXT    NOT NULL,      -- as typed
  name_key   TEXT    NOT NULL,
  note       TEXT,
  added_by   TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (trip_id, name_key)
);

CREATE INDEX IF NOT EXISTS idx_members_trip ON trip_members (trip_id);

-- Getting there and back. Two rows at most per trip: the direction is the key.
CREATE TABLE IF NOT EXISTS trip_travel (
  trip_id     INTEGER NOT NULL DEFAULT 1,
  direction   TEXT    NOT NULL CHECK (direction IN ('out', 'back')),
  mode        TEXT,
  carrier     TEXT,
  from_place  TEXT,
  to_place    TEXT,
  depart_date TEXT,
  depart_time TEXT,
  arrive_time TEXT,
  reference   TEXT,
  note        TEXT,
  set_by      TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (trip_id, direction)
);

-- Which migrations a database has had. A fresh database is already at the
-- shape they produce, so every one of them is recorded here up front and
-- `npm run migrate` has nothing to do.
CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT    PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES
  ('migrate-001-bookings.sql', 0),
  ('migrate-002-plan-notes.sql', 0),
  ('migrate-003-custom-address.sql', 0),
  ('migrate-004-note-address.sql', 0),
  ('migrate-005-trip-base.sql', 0),
  ('migrate-006-trip.sql', 0),
  ('migrate-007-trips.sql', 0);

-- The first trip. Seeded here as well as by the migrations, so a database
-- built fresh from this file and one brought forward end up identical.
INSERT OR IGNORE INTO trips
  (id, name, destination, start_date, end_date,
   base_name, base_lat, base_lon, near_lat, near_lon, set_by, updated_at, created_at)
VALUES (1, 'London 2026', 'London', '2026-09-11', '2026-09-16',
        'Leonardo Royal Hotel London City, 8–14 Cooper''s Row, EC3N 2BQ',
        51.5116, -0.0773, 51.5074, -0.1278, 'setup', 0, 0);
