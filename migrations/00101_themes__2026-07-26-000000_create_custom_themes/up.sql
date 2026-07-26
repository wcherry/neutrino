CREATE TABLE custom_themes (
    id           TEXT PRIMARY KEY NOT NULL,
    user_id      TEXT NOT NULL,
    name         TEXT NOT NULL,
    is_public    INTEGER NOT NULL DEFAULT 0,  -- SQLite boolean convention (see slide_themes.is_system)
    color_scheme TEXT NOT NULL,               -- 'light' | 'dark'
    tokens       TEXT NOT NULL,               -- serialized JSON object of the ~24 canonical tokens
                                               -- (TEXT-blob-of-JSON precedent: user_profiles.social_links)
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_custom_themes_user_id ON custom_themes(user_id);
CREATE INDEX idx_custom_themes_is_public ON custom_themes(is_public);
