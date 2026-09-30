DROP INDEX IF EXISTS idx_events_exception;
-- Without the columns an exception would read as a one-off event beside its series.
DELETE FROM events WHERE recurring_event_id IS NOT NULL;
ALTER TABLE events DROP COLUMN cancelled;
ALTER TABLE events DROP COLUMN original_start_time;
ALTER TABLE events DROP COLUMN recurring_event_id;
