-- Phase 2, step 9: a password, optionally.
--
-- The email link stays the way in for anyone without one, and the way back
-- in for anyone who forgets. Stored as a PBKDF2 hash with its own salt and
-- iteration count in the string, never the password itself.
ALTER TABLE users ADD COLUMN password_hash TEXT;
