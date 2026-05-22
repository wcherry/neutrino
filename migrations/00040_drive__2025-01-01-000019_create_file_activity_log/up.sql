CREATE TABLE file_activity_log (
    id TEXT PRIMARY KEY NOT NULL,
    file_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    action TEXT NOT NULL,
    detail_json TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_activity_file ON file_activity_log(file_id, created_at);
CREATE INDEX idx_activity_user ON file_activity_log(user_id, created_at);
