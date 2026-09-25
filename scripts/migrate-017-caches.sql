-- Phase 4, steps 16 and 17: what the Worker fetches from outside, kept.
--
-- Address lookups (Nominatim asks for about one call a second from a whole
-- site) and Wikipedia thumbnails (55 per visitor per page view, until now
-- from the browser) are both cached here. D1 rather than KV: no new
-- infrastructure, and the volume is tiny.
CREATE TABLE IF NOT EXISTS geocode_cache (
  key        TEXT    PRIMARY KEY,   -- lowercased query + the bias it was asked with
  results    TEXT    NOT NULL,      -- JSON, the same shape the API answers
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS photo_cache (
  wiki       TEXT    PRIMARY KEY,   -- the Wikipedia title
  url        TEXT,                  -- NULL = asked, and there is no picture
  created_at INTEGER NOT NULL
);
