CREATE VIRTUAL TABLE IF NOT EXISTS file_fts USING fts5(
    file_id UNINDEXED,
    user_id UNINDEXED,
    name,
    content,
    tokenize='porter unicode61'
);
CREATE TABLE IF NOT EXISTS file_content_index (
    file_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    indexed_at TIMESTAMP NOT NULL,
    text_content TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_fci_user ON file_content_index(user_id);
