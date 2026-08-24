-- Drop the `irm_policies` table.
--
-- Information Rights Management is gone. The six endpoints that managed these
-- policies — GET/PUT/DELETE on `/api/v1/drive/{files,folders}/{id}/irm` — had
-- no caller in any client (web, both iOS apps, or the Mac desktop app), so the
-- `drive::irm` module was removed along with the download/print/copy
-- enforcement it fed in `drive::storage` and `drive::sharing`. With no way to
-- create a policy, that enforcement could never fire.
--
-- `IF EXISTS` because the migration that created this table (formerly 00033)
-- was deleted rather than left in history: a database initialised from the
-- current migration set never creates `irm_policies` in the first place, so
-- this runs as a no-op there and only does real work on a database that
-- predates the removal.

DROP TABLE IF EXISTS irm_policies;
