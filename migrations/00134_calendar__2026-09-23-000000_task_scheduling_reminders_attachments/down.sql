DROP INDEX IF EXISTS idx_task_attachments_task;
DROP TABLE IF EXISTS task_attachments;

DROP INDEX IF EXISTS idx_tasks_event;
ALTER TABLE tasks DROP COLUMN event_id;

-- The events those tasks were scheduled as are deliberately left alone: an
-- event created from a task is an ordinary calendar event by the time it
-- exists, and deleting the user's calendar entries to reverse a schema change
-- is not a reversal.

DROP INDEX IF EXISTS idx_reminders_task;
ALTER TABLE reminders DROP COLUMN linked_task_id;
