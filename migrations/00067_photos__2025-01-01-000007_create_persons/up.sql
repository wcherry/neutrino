CREATE TABLE persons (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL,
    cover_face_id TEXT,
    cover_thumbnail TEXT,
    cover_thumbnail_mime_type TEXT,
    face_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_persons_user_id ON persons (user_id);
