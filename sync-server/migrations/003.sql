ALTER TABLE credentials RENAME TO credentials_legacy;
CREATE TABLE credentials (
  account_id TEXT NOT NULL REFERENCES accounts(id), client_id TEXT NOT NULL,
  refresh_cipher TEXT NOT NULL, PRIMARY KEY(account_id,client_id)
);
INSERT INTO credentials SELECT * FROM credentials_legacy;
DROP TABLE credentials_legacy;
INSERT OR IGNORE INTO schema_version VALUES (3);
