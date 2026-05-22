-- SQLite does not support DROP COLUMN in older versions; this is a no-op.
-- To fully revert, recreate the table without the metadata column.
ALTER TABLE photos DROP COLUMN metadata;