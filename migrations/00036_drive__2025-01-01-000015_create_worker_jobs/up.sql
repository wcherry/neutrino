CREATE TABLE worker_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    job_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'R',
    error_message TEXT,
    worker_id TEXT,
    timeout_secs INTEGER NOT NULL DEFAULT 30,
    started_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX worker_jobs_status_idx ON worker_jobs (status, created_at);

CREATE TABLE worker_registrations (
    id TEXT PRIMARY KEY NOT NULL,
    callback_url TEXT NOT NULL,
    registered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
