-- One row per (sight, voter). Toggling a vote off deletes the row.
-- sight_id is either a built-in id from src/sights.js or a "custom-…" id.
CREATE TABLE IF NOT EXISTS votes (
  sight_id   TEXT    NOT NULL,
  voter_key  TEXT    NOT NULL,   -- lowercased name, the identity
  voter_name TEXT    NOT NULL,   -- as typed, for display
  created_at INTEGER NOT NULL,   -- epoch ms
  PRIMARY KEY (sight_id, voter_key)
);

CREATE INDEX IF NOT EXISTS idx_votes_sight ON votes (sight_id);
CREATE INDEX IF NOT EXISTS idx_votes_voter ON votes (voter_key);

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
  lon              REAL
);

CREATE INDEX IF NOT EXISTS idx_custom_created ON custom_sights (created_at);

-- Comments on an option. Anyone can write, only the author can delete.
CREATE TABLE IF NOT EXISTS comments (
  id         TEXT    PRIMARY KEY,   -- "c-<uuid>"
  sight_id   TEXT    NOT NULL,      -- built-in id or "custom-…"
  author     TEXT    NOT NULL,      -- as typed
  author_key TEXT    NOT NULL,      -- lowercased
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_sight ON comments (sight_id, created_at);

-- Where a sight stands on the Bookings page. One row only while it is not
-- simply waiting to be booked, so the common case stores nothing.
--   'booked'  we have it — moves to its own list
--   'skipped' we decided against booking it — moves to the removed list
-- Either way the sight stays in the vote list and keeps every vote. The two
-- states are mutually exclusive, which is why this is one column and not two
-- tables.
CREATE TABLE IF NOT EXISTS booking_status (
  sight_id    TEXT    PRIMARY KEY,  -- built-in id or "custom-…"
  status      TEXT    NOT NULL CHECK (status IN ('booked', 'skipped')),
  marked_by   TEXT    NOT NULL,     -- as typed
  booked_date TEXT,                 -- YYYY-MM-DD, the slot we actually hold
  booked_time TEXT,                 -- HH:MM, when it starts
  booked_end  TEXT,                 -- HH:MM, when we expect to be done
  created_at  INTEGER NOT NULL
);

-- Sights put on the plan by hand — the ones with nothing to book, so nothing
-- else would ever place them. Booked sights come from booking_status instead
-- and never need a row here.
CREATE TABLE IF NOT EXISTS plan_entries (
  sight_id   TEXT    PRIMARY KEY,   -- built-in id or "custom-…"
  day        TEXT    NOT NULL,      -- YYYY-MM-DD
  start_time TEXT,                  -- HH:MM
  end_time   TEXT,                  -- HH:MM
  added_by   TEXT    NOT NULL,      -- as typed
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_day ON plan_entries (day, start_time);

-- Anything on the plan that isn't one of the sights: a musical already booked,
-- meeting friends, a train. Just a label and when it happens. Kept apart from
-- plan_entries because that table is keyed on a sight and these have none.
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
  lon        REAL
);

CREATE INDEX IF NOT EXISTS idx_notes_day ON plan_notes (day, start_time);

-- Where the days start: the hotel, or whatever we are staying in. One row.
-- Routes can begin here instead of from wherever a phone happens to be, which
-- is what you want at nine in the morning.
CREATE TABLE IF NOT EXISTS trip_settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  base_name  TEXT,
  base_lat   REAL,
  base_lon   REAL,
  set_by     TEXT,
  updated_at INTEGER
);

-- Seeded here as well as in the migration, so a database built fresh from this
-- file and one brought forward by migrations end up identical. Drift between
-- those two is the kind of difference that only shows up in production.
INSERT OR IGNORE INTO trip_settings (id, base_name, base_lat, base_lon, set_by, updated_at)
VALUES (1, 'Leonardo Royal Hotel London City, 8–14 Cooper''s Row, EC3N 2BQ',
        51.5116, -0.0773, 'setup', 0);
