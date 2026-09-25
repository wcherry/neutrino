DROP INDEX IF EXISTS idx_task_tags_tag;
DROP TABLE IF EXISTS task_tags;

ALTER TABLE tasks DROP COLUMN repeat_after_completion;
ALTER TABLE tasks DROP COLUMN recurrence_rule;
ALTER TABLE tasks DROP COLUMN location;
ALTER TABLE tasks DROP COLUMN estimate_minutes;
ALTER TABLE tasks DROP COLUMN priority;
ALTER TABLE tasks DROP COLUMN start_has_time;
ALTER TABLE tasks DROP COLUMN start_date;
ALTER TABLE tasks DROP COLUMN due_has_time;
