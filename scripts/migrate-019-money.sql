-- Costs and money.
--
-- A trip has one currency, and expenses: what was paid, how much, by whom,
-- and for whom. Each expense is split equally among the people it was for
-- (everyone on the trip when nobody is named). Amounts are whole minor
-- units — cents, pence — so nothing is ever a float.
ALTER TABLE trips ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR';
UPDATE trips SET currency = 'GBP' WHERE id = 1 AND destination = 'London';

CREATE TABLE IF NOT EXISTS expenses (
  id         TEXT    PRIMARY KEY,   -- "x-<uuid>"
  trip_id    INTEGER NOT NULL,
  label      TEXT    NOT NULL,
  amount     INTEGER NOT NULL,      -- minor units, > 0
  paid_by    TEXT    NOT NULL,      -- member name_key
  for_keys   TEXT,                  -- JSON array of member name_keys; NULL = everyone
  day        TEXT,                  -- YYYY-MM-DD, optional
  item_id    TEXT,                  -- the place it belongs to, optional
  added_by   TEXT    NOT NULL,      -- member name
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_trip ON expenses (trip_id, created_at);
