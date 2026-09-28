-- Notes on a stop and on a day: one short shared text per thing, edited in
-- place by any editor. The target is a place (an item id), one of your own
-- entries (a "note-…" id) or a day of the trip (YYYY-MM-DD). Called memos
-- here because `plan_notes` — your own entries — already took the word.
CREATE TABLE IF NOT EXISTS memos (
  trip_id    INTEGER NOT NULL,
  target     TEXT    NOT NULL,      -- an item id, a "note-…" id, or a day
  text       TEXT    NOT NULL,      -- up to 2000 characters, line breaks kept
  set_by     TEXT    NOT NULL,      -- who last edited it, as typed
  set_by_key TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, target)
);
