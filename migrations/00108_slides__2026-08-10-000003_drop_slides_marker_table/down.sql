-- Recreate the `slides` marker table, reconstructing one row per file that
-- carries the native presentation mime type — exactly the set it used to
-- hold. Timestamps come from the file rather than being invented, so a round
-- trip preserves what the API would report.

CREATE TABLE slides (
    file_id    TEXT PRIMARY KEY NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO slides (file_id, created_at, updated_at)
SELECT id, created_at, updated_at
FROM files
WHERE mime_type = 'application/x-neutrino-slide';
