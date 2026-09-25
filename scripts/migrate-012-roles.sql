-- Phase 2, step 7: roles, and invites.
--
-- Every member has a role: owner (the trip and its people), editor (places,
-- bookings, the plan), viewer (votes and comments). The London trip's owner
-- is Emily — the member row, whichever account claims it.
--
-- An invite is a link sent by email that signs the person in and puts them
-- on the trip in one step. Only a hash of the token is stored.

ALTER TABLE trip_members ADD COLUMN role TEXT NOT NULL DEFAULT 'editor';

UPDATE trip_members SET role = 'owner' WHERE trip_id = 1 AND name_key = 'emily';

CREATE TABLE IF NOT EXISTS invites (
  token_hash  TEXT    PRIMARY KEY,
  trip_id     INTEGER NOT NULL,
  email       TEXT    NOT NULL,      -- lowercased
  role        TEXT    NOT NULL DEFAULT 'editor'
                      CHECK (role IN ('owner', 'editor', 'viewer')),
  member_id   TEXT,                  -- an existing, unclaimed name to become
  name        TEXT,                  -- or the name to create
  invited_by  TEXT    NOT NULL,      -- member name
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,      -- seven days
  accepted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_invites_trip ON invites (trip_id, created_at);
