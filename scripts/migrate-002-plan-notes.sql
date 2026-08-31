-- Your own entries on the plan: a musical, dinner, a train. Additive only.
CREATE TABLE IF NOT EXISTS plan_notes (
  id         TEXT    PRIMARY KEY,
  day        TEXT    NOT NULL,
  start_time TEXT,
  end_time   TEXT,
  label      TEXT    NOT NULL,
  added_by   TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_day ON plan_notes (day, start_time);
