-- Recreate the `diagrams` marker table and point `diagram_comments` back at it.
--
-- Marker rows are reconstructed from the files carrying the native diagram mime
-- type — exactly the set the table used to hold — with timestamps taken from
-- the file rather than invented, so a round trip preserves what the API reports.

PRAGMA foreign_keys = OFF;

CREATE TABLE diagrams (
    file_id     TEXT PRIMARY KEY NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO diagrams (file_id, created_at, updated_at)
SELECT id, created_at, updated_at
FROM files
WHERE mime_type = 'application/x-neutrino-diagram';

CREATE TABLE diagram_comments_old (
    id          TEXT PRIMARY KEY NOT NULL,
    file_id     TEXT NOT NULL REFERENCES diagrams(file_id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    content     TEXT NOT NULL,
    parent_id   TEXT,
    shape_id    TEXT,
    resolved    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO diagram_comments_old (
    id, file_id, user_id, content, parent_id, shape_id, resolved, created_at, updated_at
)
SELECT
    c.id, c.file_id, c.user_id, c.content, c.parent_id, c.shape_id,
    c.resolved, c.created_at, c.updated_at
FROM diagram_comments c
WHERE EXISTS (SELECT 1 FROM diagrams d WHERE d.file_id = c.file_id);

DROP TABLE diagram_comments;
ALTER TABLE diagram_comments_old RENAME TO diagram_comments;
CREATE INDEX idx_diagram_comments_file_id ON diagram_comments(file_id);

PRAGMA foreign_keys = ON;
