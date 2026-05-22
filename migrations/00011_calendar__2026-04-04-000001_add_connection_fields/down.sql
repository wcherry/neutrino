-- SQLite does not support DROP COLUMN in older versions; recreate table without the added columns.
CREATE TABLE calendar_connections_backup AS SELECT id, user_id, provider, access_token, refresh_token, expires_at, sync_cursor, created_at, updated_at FROM calendar_connections;
DROP TABLE calendar_connections;
ALTER TABLE calendar_connections_backup RENAME TO calendar_connections;
CREATE UNIQUE INDEX idx_calendar_connections_user_provider ON calendar_connections (user_id, provider);
