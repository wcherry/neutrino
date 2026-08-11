-- Recreate the `sheets` marker table and point `named_ranges` back at it.
--
-- The marker rows are reconstructed from the files that carry the native
-- spreadsheet mime type, which is exactly the set the table used to hold.
-- `created_at`/`updated_at` come from the file rather than being invented, so
-- a round trip through up/down preserves the timestamps the API would report.

PRAGMA foreign_keys = OFF;

CREATE TABLE sheets (
    file_id    TEXT PRIMARY KEY NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO sheets (file_id, created_at, updated_at)
SELECT id, created_at, updated_at
FROM files
WHERE mime_type = 'application/x-neutrino-sheet';

CREATE TABLE named_ranges_old (
    id          TEXT PRIMARY KEY NOT NULL,
    sheet_db_id TEXT NOT NULL REFERENCES sheets(file_id) ON DELETE CASCADE,
    sheet_id    TEXT NOT NULL,
    start_row   INTEGER NOT NULL,
    start_col   INTEGER NOT NULL,
    end_row     INTEGER NOT NULL,
    end_col     INTEGER NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO named_ranges_old (
    id, sheet_db_id, sheet_id, start_row, start_col, end_row, end_col, created_at, updated_at
)
SELECT
    nr.id, nr.sheet_db_id, nr.sheet_id, nr.start_row, nr.start_col,
    nr.end_row, nr.end_col, nr.created_at, nr.updated_at
FROM named_ranges nr
WHERE EXISTS (SELECT 1 FROM sheets s WHERE s.file_id = nr.sheet_db_id);

DROP TABLE named_ranges;
ALTER TABLE named_ranges_old RENAME TO named_ranges;
CREATE INDEX named_ranges_sheet_db_id ON named_ranges(sheet_db_id);

PRAGMA foreign_keys = ON;
