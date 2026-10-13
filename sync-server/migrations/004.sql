ALTER TABLE challenges ADD COLUMN verifier_hash TEXT;
CREATE TABLE handoff_tickets (
  ticket_hash TEXT PRIMARY KEY, verifier_hash TEXT NOT NULL,
  result_cipher TEXT NOT NULL, expires_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO schema_version VALUES (4);
