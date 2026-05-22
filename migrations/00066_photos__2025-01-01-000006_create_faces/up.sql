CREATE TABLE faces (
    id                  TEXT NOT NULL PRIMARY KEY,
    photo_id            TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    bounding_box        TEXT NOT NULL,
    thumbnail           TEXT,
    thumbnail_mime_type TEXT,
    person_id           TEXT,
    embedding           TEXT,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_faces_photo_id ON faces (photo_id);
