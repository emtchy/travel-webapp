-- Phase 2, step 6: an account claims its name on a trip.
--
-- A member row is what a trip knows about a person: the name their votes,
-- comments and bookings are keyed on. Linking it to an account means the
-- account acts as that name from then on, and everything already recorded
-- under the name is theirs. One account per member, one member per account
-- on a given trip.

ALTER TABLE trip_members ADD COLUMN user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_user
  ON trip_members (trip_id, user_id) WHERE user_id IS NOT NULL;
