DELETE FROM slide_themes WHERE is_system = 1;

-- SQLite does not support DROP COLUMN in older versions; recreate table without is_system.
CREATE TABLE slide_themes_backup (
    id                  TEXT PRIMARY KEY NOT NULL,
    user_id             TEXT NOT NULL,
    name                TEXT NOT NULL,
    primary_color       TEXT NOT NULL,
    background_color    TEXT NOT NULL,
    text_color          TEXT NOT NULL,
    accent_color        TEXT NOT NULL,
    font_family         TEXT NOT NULL DEFAULT 'Inter',
    background_image    TEXT,
    gradient_background TEXT,
    default_transition  TEXT NOT NULL DEFAULT 'fade',
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO slide_themes_backup
    SELECT id, user_id, name, primary_color, background_color, text_color, accent_color,
           font_family, background_image, gradient_background, default_transition, created_at, updated_at
    FROM slide_themes;

DROP TABLE slide_themes;
ALTER TABLE slide_themes_backup RENAME TO slide_themes;

CREATE INDEX slide_themes_user_id_idx ON slide_themes (user_id);
