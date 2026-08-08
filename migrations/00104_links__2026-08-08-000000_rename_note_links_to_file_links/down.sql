DROP INDEX idx_file_links_target;
ALTER TABLE file_links RENAME COLUMN target_file_id TO target_note_id;
ALTER TABLE file_links RENAME COLUMN source_file_id TO source_note_id;
ALTER TABLE file_links RENAME TO note_links;
CREATE INDEX idx_note_links_target ON note_links(target_note_id);
