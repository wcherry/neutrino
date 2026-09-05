DROP INDEX IF EXISTS idx_teams_live_storage;

-- Back to unlimited for the teams this set, which is not quite a reversal: a
-- team an administrator had deliberately limited to something else keeps that
-- limit, because only the backfilled value is this migration's to take back.
UPDATE teams
   SET storage_limit_bytes = NULL
 WHERE storage_limit_bytes = 10737418240;
