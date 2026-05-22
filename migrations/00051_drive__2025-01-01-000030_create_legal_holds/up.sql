CREATE TABLE legal_holds (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_by TEXT NOT NULL,
    custodian_ids TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE retention_policies (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    retain_for_days INTEGER NOT NULL,
    applies_to_mime_type TEXT,
    applies_to_user_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE file_legal_holds (
    file_id TEXT NOT NULL,
    hold_id TEXT NOT NULL REFERENCES legal_holds(id),
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (file_id, hold_id)
);
