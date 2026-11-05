-- Server operators can grant complimentary history access without fabricating Apple transactions.
CREATE TABLE operator_access (
 household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
 granted_ms INTEGER NOT NULL,
 expires_ms INTEGER,
 revoked_ms INTEGER,
 reason TEXT NOT NULL
) STRICT;
