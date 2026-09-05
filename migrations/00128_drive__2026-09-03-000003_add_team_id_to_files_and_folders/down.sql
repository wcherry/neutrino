-- Take the team scope back off files and folders.
--
-- The rows themselves survive, and that is the part to be careful about: a file
-- uploaded into a team becomes an ordinary file owned by whoever uploaded it,
-- sitting in that person's My Drive. Nothing is deleted, but the team's library
-- is dispersed among its members and cannot be reassembled from what is left.
-- Run this only together with 00126's rollback, which removes the teams the
-- column pointed at.
DROP INDEX IF EXISTS idx_folders_team_parent;
DROP INDEX IF EXISTS idx_files_team_folder;

ALTER TABLE folders DROP COLUMN team_id;
ALTER TABLE files DROP COLUMN team_id;
