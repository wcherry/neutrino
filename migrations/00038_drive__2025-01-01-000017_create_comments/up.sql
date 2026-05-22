CREATE TABLE comments (
    id TEXT PRIMARY KEY NOT NULL,
    file_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    anchor_json TEXT,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    assignee_id TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    resolved_by TEXT
);
CREATE INDEX idx_comments_file ON comments(file_id, status);
CREATE INDEX idx_comments_user ON comments(user_id);

CREATE TABLE comment_replies (
    id TEXT PRIMARY KEY NOT NULL,
    comment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_comment_replies_comment ON comment_replies(comment_id);
