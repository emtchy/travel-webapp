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
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_custom_created ON custom_sights (created_at);
