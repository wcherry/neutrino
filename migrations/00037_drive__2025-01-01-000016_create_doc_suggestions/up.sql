CREATE TABLE doc_suggestions (
    id TEXT PRIMARY KEY NOT NULL,
    file_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    content_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    resolved_by TEXT
);
CREATE INDEX idx_doc_suggestions_file ON doc_suggestions(file_id, status);
