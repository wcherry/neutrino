-- Sheets table: tracks spreadsheet files.
-- file_id is a FK to files.id — each sheet is also a files entry with
-- mime_type = 'application/x-neutrino-sheet' and content stored via versioning.
CREATE TABLE sheets (
    file_id    TEXT PRIMARY KEY NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
