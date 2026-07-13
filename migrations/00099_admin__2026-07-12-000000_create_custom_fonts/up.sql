CREATE TABLE custom_fonts (
    id                TEXT PRIMARY KEY NOT NULL,
    display_name      TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    format            TEXT NOT NULL,   -- 'woff2' | 'woff' | 'ttf' | 'otf'
    storage_key       TEXT NOT NULL,   -- resolved via LocalFileStore
    uploaded_by       TEXT NOT NULL,   -- user id
    created_at        TEXT NOT NULL
);
