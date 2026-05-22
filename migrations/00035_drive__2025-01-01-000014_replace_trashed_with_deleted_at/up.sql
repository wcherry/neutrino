-- Migrate files: replace is_trashed + trashed_at with deleted_at
CREATE TABLE files_new (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    storage_path TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    folder_id TEXT REFERENCES folders(id),
    is_starred INTEGER NOT NULL DEFAULT 0,
    deleted_at TIMESTAMP
);

INSERT INTO files_new
SELECT id, user_id, name, size_bytes, mime_type, storage_path, created_at, updated_at, folder_id, is_starred,
    CASE WHEN is_trashed = 1 THEN COALESCE(trashed_at, updated_at) ELSE NULL END
FROM files;

DROP INDEX IF EXISTS idx_files_user_id;
DROP INDEX IF EXISTS idx_files_folder_id;
DROP TABLE files;
ALTER TABLE files_new RENAME TO files;
CREATE INDEX idx_files_user_id ON files(user_id);
CREATE INDEX idx_files_folder_id ON files(folder_id);

-- Migrate folders: replace is_trashed + trashed_at with deleted_at
CREATE TABLE folders_new (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL,
    parent_id TEXT REFERENCES folders_new(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_starred INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    deleted_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO folders_new
SELECT id, user_id, parent_id, name, is_starred, color,
    CASE WHEN is_trashed = 1 THEN COALESCE(trashed_at, updated_at) ELSE NULL END,
    created_at, updated_at
FROM folders;

DROP INDEX IF EXISTS idx_folders_user_id;
DROP INDEX IF EXISTS idx_folders_parent_id;
DROP TABLE folders;
ALTER TABLE folders_new RENAME TO folders;
CREATE INDEX idx_folders_user_id ON folders(user_id);
CREATE INDEX idx_folders_parent_id ON folders(parent_id);
