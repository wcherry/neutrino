CREATE TABLE IF NOT EXISTS file_summaries (
    file_id TEXT PRIMARY KEY NOT NULL,
    summary TEXT NOT NULL,
    generated_at TIMESTAMP NOT NULL,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);
