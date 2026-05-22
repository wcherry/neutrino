CREATE TABLE user_quotas (
    user_id TEXT PRIMARY KEY NOT NULL,
    used_bytes INTEGER NOT NULL DEFAULT 0,
    daily_upload_bytes INTEGER NOT NULL DEFAULT 0,
    daily_reset_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Per-user limits set by admin; NULL means no limit enforced
    quota_bytes INTEGER,
    daily_cap_bytes INTEGER
);
