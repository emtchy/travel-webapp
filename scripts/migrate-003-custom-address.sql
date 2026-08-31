-- Lets an added sight carry a location, so it can appear in a day's route.
-- Additive: existing rows get NULLs and behave exactly as before.
ALTER TABLE custom_sights ADD COLUMN address TEXT;
ALTER TABLE custom_sights ADD COLUMN lat     REAL;
ALTER TABLE custom_sights ADD COLUMN lon     REAL;
