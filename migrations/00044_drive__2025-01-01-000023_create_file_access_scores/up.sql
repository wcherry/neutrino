CREATE TABLE IF NOT EXISTS file_access_scores (
    file_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    score REAL NOT NULL DEFAULT 0.0,
    computed_at TIMESTAMP NOT NULL,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fas_user_score ON file_access_scores(user_id, score DESC);
