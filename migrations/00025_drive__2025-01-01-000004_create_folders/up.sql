CREATE TABLE folders (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_starred INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    is_trashed INTEGER NOT NULL DEFAULT 0,
    trashed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_folders_user_id ON folders(user_id);
CREATE INDEX idx_folders_parent_id ON folders(parent_id);
