DROP INDEX IF EXISTS idx_team_file_shares_team;
DROP INDEX IF EXISTS idx_team_file_shares_file;
DROP INDEX IF EXISTS idx_team_file_shares_team_file;
DROP TABLE IF EXISTS team_file_shares;

-- Files already moved into a team are not moved back: `files.team_id` is 00128's
-- column and a moved file is indistinguishable from one uploaded into the team.
DELETE FROM feature_flags WHERE key = 'teamFileTransfers';
