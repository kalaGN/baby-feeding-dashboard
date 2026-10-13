CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_version VALUES (1);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, apple_subject TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','deleting','deleted'))
);
CREATE TABLE IF NOT EXISTS records (
  account_id TEXT NOT NULL REFERENCES accounts(id), kind TEXT NOT NULL,
  id TEXT NOT NULL, version INTEGER NOT NULL, seq INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0, value TEXT,
  PRIMARY KEY(account_id,kind,id)
);
CREATE TABLE IF NOT EXISTS changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL REFERENCES accounts(id),
  kind TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL,
  deleted INTEGER NOT NULL, value TEXT
);
CREATE INDEX IF NOT EXISTS changes_account_seq ON changes(account_id,seq);
CREATE TABLE IF NOT EXISTS requests (
  account_id TEXT NOT NULL REFERENCES accounts(id), id TEXT NOT NULL,
  digest TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(account_id,id)
);
