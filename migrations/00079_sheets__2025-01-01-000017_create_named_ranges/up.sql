-- named_ranges: maps a stable GUID to a cell range within a specific sheet tab.
-- sheet_id references the tab identifier within the spreadsheet workbook
-- (the FortuneSheet index/id field, stored as text).
-- sheet_db_id references sheets.file_id — the parent spreadsheet record.
-- Row and column indices are 0-based, inclusive on both ends.
CREATE TABLE named_ranges (
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

CREATE INDEX named_ranges_sheet_db_id ON named_ranges(sheet_db_id);
