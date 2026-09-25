-- Phase 3, step 14: the two tables nothing has read since Phase 1 go.
--
-- trip_settings became trips (migration 007) and custom_sights became items
-- (migration 008); both were left in place until the copies had been seen to
-- be right. They have been, in production, for weeks.
DROP TABLE IF EXISTS trip_settings;
DROP TABLE IF EXISTS custom_sights;
