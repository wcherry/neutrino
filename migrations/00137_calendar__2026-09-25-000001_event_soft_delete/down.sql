DROP INDEX IF EXISTS idx_events_user_updated;
-- Soft-deleted rows would come back as live events without the column, so they go first.
DELETE FROM events WHERE deleted_at IS NOT NULL;
ALTER TABLE events DROP COLUMN deleted_at;
