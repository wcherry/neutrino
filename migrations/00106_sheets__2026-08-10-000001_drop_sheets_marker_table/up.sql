-- Drop the `sheets` marker table.
--
-- The row held nothing but `(file_id, created_at, updated_at)`. Every real
-- property of a spreadsheet — name, folder, content, versions, permissions,
-- content_version — already lived on the `files` row it pointed at, so the
-- marker's only job was to answer "is this file a spreadsheet?", which the
-- file's own mime type already answers. Worse, `updated_at` was maintained
-- here *instead of* on `files` by the rename path, so the timestamp the API
-- returned and the one Drive sorted by could disagree.
--
-- A file is now a native Neutrino spreadsheet iff
-- `files.mime_type = 'application/x-neutrino-sheet'` — see
-- `src/drive/storage/native_types.rs`.
--
-- `named_ranges.sheet_db_id` referenced `sheets(file_id)`, so it has to be
-- rebuilt against `files(id)` before the table can go. SQLite cannot alter a
-- foreign key in place, hence the copy-rename dance. Rows whose parent file no
-- longer exists are dropped rather than carried over — the old FK cascaded on
-- delete, so any such row is already orphaned and would fail the new
-- constraint.

PRAGMA foreign_keys = OFF;

CREATE TABLE named_ranges_new (
    id          TEXT PRIMARY KEY NOT NULL,
    sheet_db_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    sheet_id    TEXT NOT NULL,
    start_row   INTEGER NOT NULL,
    start_col   INTEGER NOT NULL,
    end_row     INTEGER NOT NULL,
    end_col     INTEGER NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO named_ranges_new (
    id, sheet_db_id, sheet_id, start_row, start_col, end_row, end_col, created_at, updated_at
)
SELECT
    nr.id, nr.sheet_db_id, nr.sheet_id, nr.start_row, nr.start_col,
    nr.end_row, nr.end_col, nr.created_at, nr.updated_at
FROM named_ranges nr
WHERE EXISTS (SELECT 1 FROM files f WHERE f.id = nr.sheet_db_id);

DROP TABLE named_ranges;
ALTER TABLE named_ranges_new RENAME TO named_ranges;
CREATE INDEX named_ranges_sheet_db_id ON named_ranges(sheet_db_id);

DROP TABLE sheets;

PRAGMA foreign_keys = ON;
