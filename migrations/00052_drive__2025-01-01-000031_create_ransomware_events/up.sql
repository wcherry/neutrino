CREATE TABLE ransomware_events (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    triggered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    event_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by TEXT,
    reviewed_at TIMESTAMP
);
