-- Reduce `docs` to the one thing it actually holds: page setup.
--
-- `created_at`/`updated_at` duplicated the same columns on the `files` row the
-- table points at. Worse, the rename path maintained `updated_at` *here*
-- instead of on `files`, so the timestamp the API returned and the one Drive
-- sorted by could disagree — the same split-brain the `sheets` marker table
-- had. Now that document CRUD is served by the generic drive endpoints,
-- nothing reads these columns at all.
--
-- The row also becomes optional. Reads fall back to the default page setup
-- when there is none, so no row has to be created when a document is created —
-- which is what lets documents be created through `POST /drive/files` with no
-- docs-specific step. Existing rows that only ever held the default are
-- dropped rather than migrated: they are indistinguishable from absent.
--
-- SQLite cannot drop a column with a foreign key intact, hence the rebuild.

PRAGMA foreign_keys = OFF;

CREATE TABLE docs_new (
    file_id    TEXT PRIMARY KEY NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    page_setup TEXT NOT NULL
);

INSERT INTO docs_new (file_id, page_setup)
SELECT d.file_id, d.page_setup
FROM docs d
WHERE EXISTS (SELECT 1 FROM files f WHERE f.id = d.file_id)
  AND d.page_setup <> '{"marginTop":72,"marginBottom":72,"marginLeft":72,"marginRight":72,"orientation":"portrait","pageSize":"letter"}';

DROP TABLE docs;
ALTER TABLE docs_new RENAME TO docs;

PRAGMA foreign_keys = ON;
