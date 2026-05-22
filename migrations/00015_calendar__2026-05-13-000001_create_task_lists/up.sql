CREATE TABLE task_lists (
    id         TEXT PRIMARY KEY NOT NULL,
    user_id    TEXT NOT NULL,
    name       TEXT NOT NULL,
    color      TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_task_lists_user ON task_lists (user_id);
