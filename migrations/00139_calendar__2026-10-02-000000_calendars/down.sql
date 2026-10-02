DROP INDEX IF EXISTS idx_events_calendar;
ALTER TABLE events DROP COLUMN calendar_id;
DROP TABLE calendars;
