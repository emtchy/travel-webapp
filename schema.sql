-- One row per (sight, voter). Toggling a vote off deletes the row.
CREATE TABLE IF NOT EXISTS votes (
  sight_id   TEXT    NOT NULL,
  voter_key  TEXT    NOT NULL,   -- lowercased name, the identity
  voter_name TEXT    NOT NULL,   -- as typed, for display
  created_at INTEGER NOT NULL,   -- epoch ms
  PRIMARY KEY (sight_id, voter_key)
);

CREATE INDEX IF NOT EXISTS idx_votes_sight ON votes (sight_id);
CREATE INDEX IF NOT EXISTS idx_votes_voter ON votes (voter_key);
