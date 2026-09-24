-- Phase 1, step 2: one table for every place, whoever it came from.
--
-- `items` holds the built-in places (imported by migration 009) and the ones
-- people added (copied from custom_sights here). `source` says which; the id
-- is what it always was, so every vote, comment, booking and plan entry keyed
-- on it carries straight over. custom_sights stays in place, unread, until a
-- later migration drops it — the same courtesy trip_settings got.

CREATE TABLE IF NOT EXISTS items (
  id               TEXT    PRIMARY KEY,   -- built-in slug, or "custom-<uuid>"
  trip_id          INTEGER NOT NULL DEFAULT 1,
  source           TEXT    NOT NULL DEFAULT 'added'
                           CHECK (source IN ('builtin', 'added')),
  rank             INTEGER,               -- built-ins: their place in the list
  tier             TEXT,
  name             TEXT    NOT NULL,
  name_de          TEXT,
  summary          TEXT,
  summary_de       TEXT,
  categories       TEXT,                  -- JSON array
  area             TEXT,
  station          TEXT,
  cost             TEXT    NOT NULL DEFAULT 'free'
                           CHECK (cost IN ('free', 'free-limited', 'paid', 'mixed')),
  price_label      TEXT,
  price_label_de   TEXT,
  open_on          TEXT,                  -- JSON array of weekdays
  booking_required INTEGER NOT NULL DEFAULT 0,
  flags            TEXT,                  -- JSON array
  url              TEXT,
  wiki             TEXT,                  -- Wikipedia title, for the photo
  address          TEXT,
  lat              REAL,
  lon              REAL,
  added_by         TEXT    NOT NULL,      -- as typed; 'setup' for an import
  added_by_key     TEXT    NOT NULL,      -- lowercased; only they can remove an added one
  created_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_trip ON items (trip_id, source, rank, created_at);

INSERT OR IGNORE INTO items
  (id, trip_id, source, name, summary, url, cost, price_label, booking_required,
   address, lat, lon, added_by, added_by_key, created_at)
SELECT id, trip_id, 'added', name, summary, url,
       CASE WHEN costs THEN 'paid' ELSE 'free' END, price_label, booking_required,
       address, lat, lon, added_by, added_by_key, created_at
  FROM custom_sights;
