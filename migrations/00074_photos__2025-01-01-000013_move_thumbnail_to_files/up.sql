-- Move thumbnail storage from photos to files (drive service).
-- Recreate photos table without thumbnail columns (SQLite lacks ALTER TABLE DROP COLUMN).
CREATE TABLE photos_new (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    is_starred INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    deleted_at TIMESTAMP,
    capture_date TIMESTAMP,
    metadata TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO photos_new (id, user_id, file_id, is_starred, is_archived, deleted_at, capture_date, metadata, created_at, updated_at)
    SELECT id, user_id, file_id, is_starred, is_archived, deleted_at, capture_date, metadata, created_at, updated_at
    FROM photos;

DROP TABLE photos;
ALTER TABLE photos_new RENAME TO photos;
