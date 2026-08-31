-- The trip's own record: what it is, when, who is coming, and how we get
-- there. These were constants in the Worker; moving them here is what lets a
-- second trip exist at all.
ALTER TABLE trip_settings ADD COLUMN name          TEXT;
ALTER TABLE trip_settings ADD COLUMN destination   TEXT;
ALTER TABLE trip_settings ADD COLUMN start_date    TEXT;
ALTER TABLE trip_settings ADD COLUMN end_date      TEXT;
ALTER TABLE trip_settings ADD COLUMN near_lat      REAL;
ALTER TABLE trip_settings ADD COLUMN near_lon      REAL;
ALTER TABLE trip_settings ADD COLUMN base_checkin  TEXT;
ALTER TABLE trip_settings ADD COLUMN base_checkout TEXT;
ALTER TABLE trip_settings ADD COLUMN base_ref      TEXT;
ALTER TABLE trip_settings ADD COLUMN base_phone    TEXT;
ALTER TABLE trip_settings ADD COLUMN notes         TEXT;

-- Seed from what was hardcoded, so nothing changes the moment this runs.
UPDATE trip_settings
   SET name        = COALESCE(name, 'London 2026'),
       destination = COALESCE(destination, 'London'),
       start_date  = COALESCE(start_date, '2026-09-11'),
       end_date    = COALESCE(end_date, '2026-09-16'),
       near_lat    = COALESCE(near_lat, 51.5074),
       near_lon    = COALESCE(near_lon, -0.1278)
 WHERE id = 1;

-- Who is coming. name_key is the lowercased name, the same identity the votes
-- already use, so a member and their votes line up without a migration.
CREATE TABLE IF NOT EXISTS trip_members (
  id         TEXT    PRIMARY KEY,   -- "m-<uuid>"
  name       TEXT    NOT NULL,      -- as typed
  name_key   TEXT    NOT NULL UNIQUE,
  note       TEXT,
  added_by   TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

-- Getting there and back. Two rows at most: direction is the key.
CREATE TABLE IF NOT EXISTS trip_travel (
  direction   TEXT    PRIMARY KEY CHECK (direction IN ('out', 'back')),
  mode        TEXT,                 -- flight, train, bus…
  carrier     TEXT,                 -- "Austrian OS 455"
  from_place  TEXT,
  to_place    TEXT,
  depart_date TEXT,                 -- YYYY-MM-DD
  depart_time TEXT,                 -- HH:MM
  arrive_time TEXT,
  reference   TEXT,
  note        TEXT,
  set_by      TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Everyone who has already voted is plainly on the trip.
INSERT OR IGNORE INTO trip_members (id, name, name_key, added_by, created_at)
SELECT 'm-' || voter_key, voter_name, voter_key, 'setup', 0
  FROM (SELECT voter_key, MIN(voter_name) AS voter_name
          FROM votes GROUP BY voter_key);
