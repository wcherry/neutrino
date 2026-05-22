CREATE TABLE event_attendees (
    id        TEXT PRIMARY KEY NOT NULL,
    event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    email     TEXT NOT NULL
);

CREATE INDEX idx_event_attendees_event ON event_attendees (event_id);
