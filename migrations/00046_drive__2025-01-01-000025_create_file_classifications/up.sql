CREATE TABLE IF NOT EXISTS file_classifications (
    file_id TEXT PRIMARY KEY NOT NULL,
    labels TEXT NOT NULL DEFAULT '[]',
    classified_at TIMESTAMP NOT NULL,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);
