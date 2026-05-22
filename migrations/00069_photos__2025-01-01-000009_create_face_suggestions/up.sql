CREATE TABLE face_suggestions (
    id          TEXT NOT NULL PRIMARY KEY,
    face_id     TEXT NOT NULL,
    person_id   TEXT NOT NULL,
    confidence  REAL NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_face_suggestions_face_id ON face_suggestions (face_id);
CREATE UNIQUE INDEX idx_face_suggestions_face_person ON face_suggestions (face_id, person_id);
