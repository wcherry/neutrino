-- Record where an imported file came from, so `created_at` and `updated_at`
-- can be given back to the dates the source file actually had.
--
-- A Google Takeout import used to stamp every date with the time of the run
-- (issue #110): a library imported in one afternoon sorted as though every
-- file was written that afternoon, and the photos timeline — which is nothing
-- but a sort by date — was useless for anything imported. The dates are in the
-- export (in the Drive `-info.json` sidecar, in Keep's `createdTimestampUsec`,
-- and in the zip entry itself), so the import now writes them onto the row.
--
-- That leaves nowhere to say "this arrived on the 19th", which is a real
-- question once `created_at` is a date from 2014. These two columns are that
-- answer, and the only way to tell an imported file from a native one:
--
--   imported_at   when the import run wrote this file. NULL for every file
--                 created in Neutrino itself.
--   import_source the file's path inside the export, e.g.
--                 `Takeout/Drive/Work/Q3 plan.docx` — Takeout rewrites names
--                 it cannot store in a filename, so this is the only record of
--                 which entry in the archive produced this row.
--
-- Both are NULL for existing rows, which is correct: none of them came from an
-- import.

ALTER TABLE files ADD COLUMN imported_at TIMESTAMP;
ALTER TABLE files ADD COLUMN import_source TEXT;
