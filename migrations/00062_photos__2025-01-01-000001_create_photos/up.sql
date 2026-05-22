CREATE TABLE photos (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    is_starred INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    deleted_at TIMESTAMP,
    capture_date TIMESTAMP,
    thumbnail BLOB,
    thumbnail_mime_type TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
