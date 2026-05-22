-- Recreate event_attachments with nullable file_id (for notes) and new columns
DROP TABLE IF EXISTS event_attachments;

CREATE TABLE event_attachments (
    id        TEXT PRIMARY KEY NOT NULL,
    event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    file_id   TEXT,
    name      TEXT,
    note      TEXT
);

CREATE INDEX idx_event_attachments_event ON event_attachments (event_id);
