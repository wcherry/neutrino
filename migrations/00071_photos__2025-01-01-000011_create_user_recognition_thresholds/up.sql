CREATE TABLE user_recognition_thresholds (
    user_id TEXT NOT NULL PRIMARY KEY,
    auto_tag_threshold REAL NOT NULL DEFAULT 0.30,
    suggest_threshold REAL NOT NULL DEFAULT 0.55,
    total_accepts INTEGER NOT NULL DEFAULT 0,
    total_rejects INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
