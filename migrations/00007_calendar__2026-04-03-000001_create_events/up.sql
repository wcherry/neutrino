CREATE TABLE events (
    id               TEXT PRIMARY KEY NOT NULL,
    user_id          TEXT NOT NULL,
    title            TEXT NOT NULL,
    description      TEXT,
    start_time       TIMESTAMP NOT NULL,
    end_time         TIMESTAMP NOT NULL,
    all_day          BOOLEAN NOT NULL DEFAULT 0,
    location         TEXT,
    recurrence_rule  TEXT,
    external_id      TEXT,
    source           TEXT NOT NULL DEFAULT 'local',
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_events_user_start ON events (user_id, start_time);
CREATE INDEX idx_events_start_time ON events (start_time);
