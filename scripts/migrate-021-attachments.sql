-- Attachments: the PDF ticket or the confirmation on a booking, or on one of
-- your own entries. The bytes live in R2 (the FILES binding) under
-- t/<trip>/<id>.<ext>; this row says what the file is and where it is.
CREATE TABLE IF NOT EXISTS attachments (
  id           TEXT    PRIMARY KEY,   -- "f-<uuid>"
  trip_id      INTEGER NOT NULL,
  target       TEXT    NOT NULL,      -- an item id, or a "note-…" id
  name         TEXT    NOT NULL,      -- the file name as uploaded, cleaned
  type         TEXT    NOT NULL,      -- media type; only a few are allowed
  size         INTEGER NOT NULL,      -- bytes
  key          TEXT    NOT NULL,      -- the object in the bucket
  added_by     TEXT    NOT NULL,
  added_by_key TEXT    NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_trip ON attachments (trip_id, target, created_at);
