UPDATE feature_flags SET enabled = 0, updated_at = datetime('now') WHERE key = 'driveAreaDropTarget';
