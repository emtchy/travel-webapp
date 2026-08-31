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
  booking_required INTEGER NOT NULL DEFAULT 0
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
  booked_time TEXT,                 -- HH:MM
  created_at  INTEGER NOT NULL
);
