-- Diagrams core table (backed by drive files, mirrors slides/docs pattern)
CREATE TABLE diagrams (
    file_id     TEXT PRIMARY KEY NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Yjs CRDT state for real-time collaboration (mirrors doc_yjs_state)
CREATE TABLE diagram_yjs_state (
    file_id    TEXT PRIMARY KEY NOT NULL,
    state      BLOB NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-diagram comments (threaded, Phase 3)
CREATE TABLE diagram_comments (
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

CREATE INDEX idx_diagram_comments_file_id ON diagram_comments(file_id);
