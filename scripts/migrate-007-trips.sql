-- Phase 1, step 1: the trip becomes a row among rows.
--
-- `trips` replaces the one-row trip_settings table; row 1 is copied across so
-- the London trip is trip 1 and nothing changes for it. Every table that
-- belongs to a trip gets a trip_id, defaulting to 1, so existing rows all land
-- on the London trip without being touched. trip_settings is left in place
-- for now — nothing reads it any more, and dropping it is a later migration
-- once the copy has been seen to be right.

CREATE TABLE IF NOT EXISTS trips (
  id            INTEGER PRIMARY KEY,
  name          TEXT,
  destination   TEXT,
  start_date    TEXT,
  end_date      TEXT,
  base_name     TEXT,
  base_lat      REAL,
  base_lon      REAL,
  base_checkin  TEXT,
  base_checkout TEXT,
  base_ref      TEXT,
  base_phone    TEXT,
  near_lat      REAL,
  near_lon      REAL,
  notes         TEXT,
  set_by        TEXT,
  updated_at    INTEGER,
  created_at    INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO trips
  (id, name, destination, start_date, end_date, base_name, base_lat, base_lon,
   base_checkin, base_checkout, base_ref, base_phone, near_lat, near_lon,
   notes, set_by, updated_at, created_at)
SELECT id, name, destination, start_date, end_date, base_name, base_lat, base_lon,
       base_checkin, base_checkout, base_ref, base_phone, near_lat, near_lon,
       notes, set_by, updated_at, COALESCE(updated_at, 0)
  FROM trip_settings WHERE id = 1;

-- Everything that belongs to a trip says which one.
ALTER TABLE votes          ADD COLUMN trip_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE custom_sights  ADD COLUMN trip_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE comments       ADD COLUMN trip_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE booking_status ADD COLUMN trip_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plan_entries   ADD COLUMN trip_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plan_notes     ADD COLUMN trip_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE trip_members   ADD COLUMN trip_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE trip_travel    ADD COLUMN trip_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_votes_trip    ON votes (trip_id);
CREATE INDEX IF NOT EXISTS idx_custom_trip   ON custom_sights (trip_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_trip ON comments (trip_id, created_at);
CREATE INDEX IF NOT EXISTS idx_booking_trip  ON booking_status (trip_id);
CREATE INDEX IF NOT EXISTS idx_plan_trip     ON plan_entries (trip_id, day, start_time);
CREATE INDEX IF NOT EXISTS idx_notes_trip    ON plan_notes (trip_id, day, start_time);

-- Two tables had keys that only make sense for a single trip: a member's name
-- was unique across the world, and there could be one "out" journey in total.
-- SQLite cannot change a primary key in place, so each is rebuilt: new table,
-- copy, drop, rename. The runner records this file as applied, so it runs once.
CREATE TABLE IF NOT EXISTS trip_members_v2 (
  id         TEXT    PRIMARY KEY,
  trip_id    INTEGER NOT NULL DEFAULT 1,
  name       TEXT    NOT NULL,
  name_key   TEXT    NOT NULL,
  note       TEXT,
  added_by   TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (trip_id, name_key)
);
INSERT OR IGNORE INTO trip_members_v2 (id, trip_id, name, name_key, note, added_by, created_at)
  SELECT id, trip_id, name, name_key, note, added_by, created_at FROM trip_members;
DROP TABLE trip_members;
ALTER TABLE trip_members_v2 RENAME TO trip_members;
CREATE INDEX IF NOT EXISTS idx_members_trip ON trip_members (trip_id);

CREATE TABLE IF NOT EXISTS trip_travel_v2 (
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
INSERT OR IGNORE INTO trip_travel_v2
  (trip_id, direction, mode, carrier, from_place, to_place, depart_date,
   depart_time, arrive_time, reference, note, set_by, updated_at)
  SELECT trip_id, direction, mode, carrier, from_place, to_place, depart_date,
         depart_time, arrive_time, reference, note, set_by, updated_at FROM trip_travel;
DROP TABLE trip_travel;
ALTER TABLE trip_travel_v2 RENAME TO trip_travel;
