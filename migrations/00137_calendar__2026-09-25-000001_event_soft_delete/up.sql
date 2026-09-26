-- Deleting an event now sets deleted_at (and bumps updated_at) instead of removing the row, so
-- GET /calendar/events/changes can tell a client which events are gone. Every read of live events
-- filters deleted_at IS NULL; rows deleted more than 90 days ago are purged by a daily job.
ALTER TABLE events ADD COLUMN deleted_at TIMESTAMP NULL;

-- The changes query: one user's rows by updated_at.
CREATE INDEX idx_events_user_updated ON events (user_id, updated_at);
