-- SQLite doesn't support ALTER COLUMN, so recreate photos table with thumbnail as TEXT (base64).
-- Existing thumbnails are cleared (format change; worker will regenerate them).
CREATE TABLE photos_new (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    is_starred INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    deleted_at TIMESTAMP,
    capture_date TIMESTAMP,
    thumbnail TEXT,
    thumbnail_mime_type TEXT,
    metadata TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO photos_new
    SELECT id, user_id, file_id, is_starred, is_archived, deleted_at, capture_date,
           NULL, NULL, metadata, created_at, updated_at
    FROM photos;

DROP TABLE photos;
ALTER TABLE photos_new RENAME TO photos;
