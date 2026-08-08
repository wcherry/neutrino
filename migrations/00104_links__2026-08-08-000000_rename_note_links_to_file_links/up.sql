-- Generalize note_links into file_links: the backlinks graph is no longer
-- notes-specific — any file type (notes, docs, sheets, ...) can be a source
-- or target. Same shape, renamed to match.
DROP INDEX idx_note_links_target;
ALTER TABLE note_links RENAME TO file_links;
ALTER TABLE file_links RENAME COLUMN source_note_id TO source_file_id;
ALTER TABLE file_links RENAME COLUMN target_note_id TO target_file_id;
CREATE INDEX idx_file_links_target ON file_links(target_file_id);
