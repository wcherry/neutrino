CREATE TABLE shared_drives (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_by TEXT NOT NULL,
    storage_used_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE shared_drive_members (
    id TEXT PRIMARY KEY NOT NULL,
    shared_drive_id TEXT NOT NULL REFERENCES shared_drives(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    user_name TEXT NOT NULL,
    role TEXT NOT NULL,
    added_by TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(shared_drive_id, user_id)
);

CREATE INDEX idx_sdm_drive ON shared_drive_members(shared_drive_id);
CREATE INDEX idx_sdm_user ON shared_drive_members(user_id);
