CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
  csrf_hash TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
CREATE TABLE IF NOT EXISTS challenges (
  state_hash TEXT PRIMARY KEY, nonce TEXT NOT NULL, platform TEXT NOT NULL,
  client_id TEXT NOT NULL, session_hash TEXT, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS credentials (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id), client_id TEXT NOT NULL,
  refresh_cipher TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reauth_tickets (
  ticket_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL REFERENCES sessions(token_hash),
  expires_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO schema_version VALUES (2);
