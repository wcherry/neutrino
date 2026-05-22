CREATE TABLE event_attachments (
    id        TEXT PRIMARY KEY NOT NULL,
    event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    file_id   TEXT NOT NULL
);

CREATE INDEX idx_event_attachments_event ON event_attachments (event_id);
