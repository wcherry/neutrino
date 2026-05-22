-- Recreate tasks without the old list_id column (relationships now live in task_list_memberships)
CREATE TABLE tasks_new (
    id         TEXT PRIMARY KEY NOT NULL,
    user_id    TEXT NOT NULL,
    title      TEXT NOT NULL,
    notes      TEXT,
    done       BOOLEAN NOT NULL DEFAULT 0,
    due_date   TIMESTAMP,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO tasks_new (id, user_id, title, notes, done, due_date, position, created_at, updated_at)
SELECT id, user_id, title, notes, done, due_date, position, created_at, updated_at
FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX idx_tasks_user ON tasks (user_id);
