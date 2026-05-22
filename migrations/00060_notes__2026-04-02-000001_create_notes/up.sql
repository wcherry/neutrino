-- Notes table: tracks note files.
-- file_id is the ID of the corresponding file in neutrino-drive with
-- mime_type = 'application/x-neutrino-note' and content stored as markdown.
CREATE TABLE notes (
    file_id    TEXT PRIMARY KEY NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
