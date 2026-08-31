-- Where the days start. One row, seeded with the hotel for this trip; the
-- INSERT is ignored if a row is already there, so re-running never overwrites
-- an address someone has since corrected.
CREATE TABLE IF NOT EXISTS trip_settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  base_name  TEXT,
  base_lat   REAL,
  base_lon   REAL,
  set_by     TEXT,
  updated_at INTEGER
);

INSERT OR IGNORE INTO trip_settings (id, base_name, base_lat, base_lon, set_by, updated_at)
VALUES (1, 'Leonardo Royal Hotel London City, 8–14 Cooper''s Row, EC3N 2BQ',
        51.5116, -0.0773, 'setup', 0);
