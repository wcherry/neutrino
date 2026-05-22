CREATE TABLE task_list_memberships (
    task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    list_id  TEXT NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, list_id)
);

CREATE INDEX idx_memberships_task ON task_list_memberships (task_id);
CREATE INDEX idx_memberships_list ON task_list_memberships (list_id);
