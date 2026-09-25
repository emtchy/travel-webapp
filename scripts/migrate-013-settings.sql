-- Phase 2, step 8: account settings.
--
-- Language and the maps app used to be guessed per device and kept in the
-- browser. On the account they follow the person from phone to laptop, and
-- the display name is what a trip calls them when they join without one.
ALTER TABLE users ADD COLUMN lang TEXT;   -- 'en' | 'de' | NULL = follow the device
ALTER TABLE users ADD COLUMN maps TEXT;   -- 'apple' | 'google' | NULL = follow the device
