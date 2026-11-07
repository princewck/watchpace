CREATE TABLE IF NOT EXISTS update_challenges (
 digest TEXT PRIMARY KEY, session_hash TEXT NOT NULL, device_id TEXT NOT NULL,
 version_code INTEGER NOT NULL, expires_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS update_challenge_expiry ON update_challenges(expires_ms);

CREATE TABLE IF NOT EXISTS update_attest_keys (
 household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
 key_id TEXT NOT NULL, public_key TEXT NOT NULL, counter INTEGER NOT NULL, development INTEGER NOT NULL,
 PRIMARY KEY(household_id,key_id)
) STRICT;
