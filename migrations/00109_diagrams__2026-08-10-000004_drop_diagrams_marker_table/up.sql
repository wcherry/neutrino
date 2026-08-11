-- Drop the `diagrams` marker table.
--
-- Same pure marker as `sheets` (00106) and `slides` (00108): the row held only
-- (file_id, created_at, updated_at), duplicating columns on the `files` row it
-- pointed at, and existed only to answer "is this file a diagram?" — which the
-- file's mime type already answers.
--
-- A file is now a native Neutrino diagram iff
-- `files.mime_type = 'application/x-neutrino-diagram'`; see
-- `src/drive/storage/native_types.rs`.
--
-- `diagram_comments.file_id` referenced `diagrams(file_id)`, so it is rebuilt
-- against `files(id)` first — the same copy-rename dance `named_ranges` needed
-- in 00106, since SQLite cannot alter a foreign key in place. Comments whose
-- parent file is gone are dropped rather than carried over: the old FK cascaded
-- on delete, so any such row is already orphaned and would fail the new
-- constraint.
--
-- `diagram_yjs_state` is keyed by file_id but carries no foreign key, so it
-- needs no rebuild.

PRAGMA foreign_keys = OFF;

CREATE TABLE diagram_comments_new (
    id          TEXT PRIMARY KEY NOT NULL,
    file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    content     TEXT NOT NULL,
    parent_id   TEXT,
    shape_id    TEXT,
    resolved    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO diagram_comments_new (
    id, file_id, user_id, content, parent_id, shape_id, resolved, created_at, updated_at
)
SELECT
    c.id, c.file_id, c.user_id, c.content, c.parent_id, c.shape_id,
    c.resolved, c.created_at, c.updated_at
FROM diagram_comments c
WHERE EXISTS (SELECT 1 FROM files f WHERE f.id = c.file_id);

DROP TABLE diagram_comments;
ALTER TABLE diagram_comments_new RENAME TO diagram_comments;
CREATE INDEX idx_diagram_comments_file_id ON diagram_comments(file_id);

DROP TABLE diagrams;

PRAGMA foreign_keys = ON;
