-- Per-device TLS identity and parent public keys. Private signing keys never leave phones.
CREATE TABLE IF NOT EXISTS lan_identities (
 device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
 certificate_sha256 TEXT NOT NULL, updated_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS lan_pairings (
 id TEXT PRIMARY KEY,household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 public_key_der TEXT NOT NULL,created_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS lan_device_keys ON lan_pairings(device_id,expires_ms);
CREATE TABLE IF NOT EXISTS lan_operation_results (
 household_id TEXT NOT NULL,request_id TEXT NOT NULL,result_revision INTEGER NOT NULL,
 PRIMARY KEY(household_id,request_id),
 FOREIGN KEY(household_id,request_id) REFERENCES operations(household_id,request_id) ON DELETE CASCADE
) STRICT;
CREATE TRIGGER IF NOT EXISTS apply_lan_policy AFTER INSERT ON operations
WHEN NEW.kind='policy' BEGIN
 UPDATE households SET policy_json=json_extract(NEW.payload_json,'$.policy') WHERE id=NEW.household_id;
 UPDATE devices SET revision=revision+1 WHERE household_id=NEW.household_id;
END;
