CREATE TABLE reminders (
    id               TEXT PRIMARY KEY NOT NULL,
    user_id          TEXT NOT NULL,
    title            TEXT NOT NULL,
    due_time         TIMESTAMP NOT NULL,
    completed        BOOLEAN NOT NULL DEFAULT 0,
    recurrence_rule  TEXT,
    linked_event_id  TEXT,
    notified_at      TIMESTAMP,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reminders_user_due ON reminders (user_id, due_time);
CREATE INDEX idx_reminders_due_pending ON reminders (due_time, completed);
