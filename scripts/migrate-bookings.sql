-- Run once against any database created before the Bookings page existed.
-- CREATE TABLE IF NOT EXISTS cannot add columns to a table that already exists.
ALTER TABLE custom_sights ADD COLUMN costs            INTEGER NOT NULL DEFAULT 0;
ALTER TABLE custom_sights ADD COLUMN price_label      TEXT;
ALTER TABLE custom_sights ADD COLUMN booking_required INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS booking_status (
  sight_id    TEXT    PRIMARY KEY,
  status      TEXT    NOT NULL CHECK (status IN ('booked', 'skipped')),
  marked_by   TEXT    NOT NULL,
  booked_date TEXT,
  booked_time TEXT,
  created_at  INTEGER NOT NULL
);
