-- Restore the timestamp columns and give every native document a row again.
--
-- Documents whose page setup was the default have no row after the up
-- migration, so they are re-created here from the set of files carrying the
-- native doc mime type. Timestamps come from the file rather than being
-- invented, so a round trip reports the same values the API would.

PRAGMA foreign_keys = OFF;

CREATE TABLE docs_old (
    file_id    TEXT PRIMARY KEY NOT NULL,
    page_setup TEXT NOT NULL DEFAULT '{"marginTop":72,"marginBottom":72,"marginLeft":72,"marginRight":72,"orientation":"portrait","pageSize":"letter"}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO docs_old (file_id, page_setup, created_at, updated_at)
SELECT
    f.id,
    COALESCE(d.page_setup, '{"marginTop":72,"marginBottom":72,"marginLeft":72,"marginRight":72,"orientation":"portrait","pageSize":"letter"}'),
    f.created_at,
    f.updated_at
FROM files f
LEFT JOIN docs d ON d.file_id = f.id
WHERE f.mime_type = 'application/x-neutrino-doc';

DROP TABLE docs;
ALTER TABLE docs_old RENAME TO docs;

PRAGMA foreign_keys = ON;
