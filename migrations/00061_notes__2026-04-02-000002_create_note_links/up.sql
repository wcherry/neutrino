-- note_links table: tracks [[wiki-style]] links between notes.
-- source_note_id links TO target_note_id.
-- Composite PK prevents duplicate edges.
CREATE TABLE note_links (
    source_note_id TEXT NOT NULL,
    target_note_id TEXT NOT NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (source_note_id, target_note_id)
);
CREATE INDEX idx_note_links_target ON note_links(target_note_id);
