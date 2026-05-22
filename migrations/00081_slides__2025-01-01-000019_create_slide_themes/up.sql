-- Slide themes: per-user custom colour themes for presentations.
CREATE TABLE slide_themes (
    id               TEXT PRIMARY KEY NOT NULL,
    user_id          TEXT NOT NULL,
    name             TEXT NOT NULL,
    primary_color    TEXT NOT NULL,
    background_color TEXT NOT NULL,
    text_color       TEXT NOT NULL,
    accent_color     TEXT NOT NULL,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX slide_themes_user_id_idx ON slide_themes (user_id);
