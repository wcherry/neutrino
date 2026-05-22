-- Slides table: tracks presentation files.
-- file_id is a FK to files.id — each presentation is also a files entry with
-- mime_type = 'application/x-neutrino-slides' and content stored via versioning.
CREATE TABLE slides (
    file_id    TEXT PRIMARY KEY NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
