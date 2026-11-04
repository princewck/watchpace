ALTER TABLE devices ADD COLUMN policy_json TEXT;
CREATE TABLE tv_access (
 device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 granted_ms INTEGER NOT NULL,
 PRIMARY KEY(device_id,household_id)
) STRICT;
CREATE TABLE tv_invitations (
 id TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 code_hash TEXT NOT NULL UNIQUE,expires_ms INTEGER NOT NULL,
 requester_id TEXT REFERENCES households(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN('open','pending','approved','rejected')),created_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX tv_invite_device ON tv_invitations(device_id,status);
DROP TRIGGER IF EXISTS apply_lan_policy;
CREATE TRIGGER apply_lan_policy AFTER INSERT ON operations WHEN NEW.kind='policy' BEGIN
 UPDATE devices SET policy_json=json_extract(NEW.payload_json,'$.policy'),revision=revision+1
 WHERE id=NEW.device_id AND household_id=NEW.household_id;
END;
