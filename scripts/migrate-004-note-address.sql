-- Lets your own plan entries carry a location, so routes can include them.
-- Additive: existing rows get NULLs and behave exactly as before.
ALTER TABLE plan_notes ADD COLUMN address TEXT;
ALTER TABLE plan_notes ADD COLUMN lat     REAL;
ALTER TABLE plan_notes ADD COLUMN lon     REAL;
