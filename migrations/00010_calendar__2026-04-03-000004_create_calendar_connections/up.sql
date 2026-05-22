CREATE TABLE calendar_connections (
    id            TEXT PRIMARY KEY NOT NULL,
    user_id       TEXT NOT NULL,
    provider      TEXT NOT NULL,
    access_token  TEXT NOT NULL,
    refresh_token TEXT,
    expires_at    TIMESTAMP,
    sync_cursor   TEXT,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_calendar_connections_user_provider ON calendar_connections (user_id, provider);
