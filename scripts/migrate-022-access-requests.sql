-- Asking to join: someone signed in but not on a trip can ask its owner for
-- a seat. One open request per person per trip; the owner accepts with a
-- role or declines, and the row keeps the outcome.
CREATE TABLE IF NOT EXISTS access_requests (
  id         TEXT    PRIMARY KEY,   -- "r-<uuid>"
  trip_id    INTEGER NOT NULL,
  user_id    TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'open',   -- open | accepted | declined
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_access_requests_trip ON access_requests (trip_id, status, created_at);
