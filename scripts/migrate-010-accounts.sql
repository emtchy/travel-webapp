-- Phase 2, step 5: accounts, signed in by a link sent by email.
--
-- No passwords anywhere. A sign-in is a one-time token mailed to the address;
-- opening the link proves the mailbox is theirs, creates the user if new, and
-- starts a session held in a cookie. Only hashes of tokens and session ids
-- are stored, so the database on its own cannot sign anyone in.

CREATE TABLE IF NOT EXISTS users (
  id           TEXT    PRIMARY KEY,   -- "u-<uuid>"
  email        TEXT    NOT NULL UNIQUE,  -- lowercased
  display_name TEXT    NOT NULL,      -- from the address until they set one
  created_at   INTEGER NOT NULL,
  last_seen    INTEGER
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT    PRIMARY KEY,     -- sha-256 of the token in the link
  email      TEXT    NOT NULL,
  next_path  TEXT,                    -- where to land afterwards
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,        -- fifteen minutes
  used_at    INTEGER                  -- a link works once
);

CREATE INDEX IF NOT EXISTS idx_login_email ON login_tokens (email, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash    TEXT    PRIMARY KEY,     -- sha-256 of the cookie value
  user_id    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,        -- thirty days, extended on use
  last_seen  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
