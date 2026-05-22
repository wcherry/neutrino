-- SQLite does not support DROP COLUMN, so reverting the theme expansion is not possible
-- without recreating the table. Recreate slide_templates instead.
CREATE TABLE IF NOT EXISTS slide_templates (
    id          TEXT PRIMARY KEY NOT NULL,
    user_id     TEXT,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT 'basic',
    content     TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
