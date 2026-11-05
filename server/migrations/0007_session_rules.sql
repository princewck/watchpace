-- Reported capability prevents enabling a rule that an older client cannot execute.
ALTER TABLE devices ADD COLUMN session_rules_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN update_protocol_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN client_version_code INTEGER;
CREATE INDEX usage_sample_session ON usage_samples(device_id,at_ms,event_id);
