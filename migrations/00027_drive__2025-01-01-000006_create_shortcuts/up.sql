CREATE TABLE shortcuts (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL,
    target_file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_shortcuts_user_id ON shortcuts(user_id);
CREATE INDEX idx_shortcuts_folder_id ON shortcuts(folder_id);
CREATE INDEX idx_shortcuts_target_file_id ON shortcuts(target_file_id);
