-- SQLite does not support DROP COLUMN on older versions; recreate the table
DROP INDEX IF EXISTS idx_files_folder_id;

CREATE TABLE files_backup (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO files_backup SELECT id, user_id, name, size_bytes, mime_type, storage_path, created_at, updated_at FROM files;
DROP TABLE files;
ALTER TABLE files_backup RENAME TO files;
CREATE INDEX idx_files_user_id ON files(user_id);
