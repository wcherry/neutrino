-- Drop the Team object and its membership.
--
-- Destructive in the way any table drop is: every team, and with it every
-- membership, is gone. Pages (00127) and the `team_id` columns on files and
-- folders (00128) roll back first, so nothing is left pointing at a team that
-- no longer exists.
DROP INDEX IF EXISTS idx_team_members_user;
DROP INDEX IF EXISTS idx_team_members_unique;
DROP TABLE IF EXISTS team_members;

DROP INDEX IF EXISTS idx_teams_deleted_created;
DROP INDEX IF EXISTS idx_teams_slug_live;
DROP TABLE IF EXISTS teams;
