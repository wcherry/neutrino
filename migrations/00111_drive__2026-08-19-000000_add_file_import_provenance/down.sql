-- Drop the import provenance columns.
--
-- The dates the import wrote into `created_at`/`updated_at` stay as they are:
-- they are the source files' real dates, and putting the import time back
-- would be reintroducing the bug this fixed. What is lost is the record of
-- which files came from an import and where in the archive they came from.

ALTER TABLE files DROP COLUMN import_source;
ALTER TABLE files DROP COLUMN imported_at;
