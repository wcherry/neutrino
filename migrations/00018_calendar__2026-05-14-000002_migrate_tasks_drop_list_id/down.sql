-- Restore the old tasks schema with list_id (data loss on list memberships beyond first)
CREATE TABLE tasks_old (
    id         TEXT PRIMARY KEY NOT NULL,
    list_id    TEXT NOT NULL REFERENCES task_lists(id),
    user_id    TEXT NOT NULL,
    title      TEXT NOT NULL,
    notes      TEXT,
    done       BOOLEAN NOT NULL DEFAULT 0,
    due_date   TIMESTAMP,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO tasks_old (id, list_id, user_id, title, notes, done, due_date, position, created_at, updated_at)
SELECT t.id, m.list_id, t.user_id, t.title, t.notes, t.done, t.due_date, t.position, t.created_at, t.updated_at
FROM tasks t
JOIN (SELECT task_id, MIN(list_id) AS list_id FROM task_list_memberships GROUP BY task_id) m
    ON t.id = m.task_id;

DELETE FROM task_list_memberships;

DROP TABLE tasks;
ALTER TABLE tasks_old RENAME TO tasks;

CREATE INDEX idx_tasks_user_list ON tasks (user_id, list_id);
CREATE INDEX idx_tasks_list_position ON tasks (list_id, position);
