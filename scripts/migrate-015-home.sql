-- Phase 3, step 13: your trips, organised.
--
-- Which trip comes first on the front page follows the dates — a trip that
-- includes today, else the nearest one to come — unless a person has pinned
-- one. A trip that was planned and never happened is marked cancelled so it
-- does not sit among the past trips as if it had.
ALTER TABLE users ADD COLUMN pinned_trip_id INTEGER;
ALTER TABLE trips ADD COLUMN status TEXT NOT NULL DEFAULT 'planned';   -- 'planned' | 'cancelled'
