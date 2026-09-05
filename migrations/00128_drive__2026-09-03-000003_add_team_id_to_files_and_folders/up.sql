-- Team Spaces (#185), phase 4: give files and folders a team.
--
-- A team's file library reuses these tables rather than getting its own pair.
-- The success criteria ask that team content "use the existing encryption,
-- versioning, search and activity infrastructure rather than parallel copies",
-- and those four subsystems all key off `files.id`: `file_versions`,
-- `file_activity_log`, the encrypted-metadata envelope and the search index
-- would each need a team-shaped twin otherwise. One nullable column is the
-- cheaper half of that trade.
--
-- The cost, and it is a real one worth naming in review: every existing query
-- on these tables now has a scope it did not have to state before. A query that
-- filters on `user_id` alone will pick up team rows uploaded by that user. The
-- team-scoped reads live in `src/drive/teams/repository.rs` and always filter
-- `team_id`; the My Drive reads in `src/drive/filesystem/repository.rs` gain
-- `team_id IS NULL`, which is what they always meant.
--
--   team_id  NULL for everything in My Drive, which is every existing row.
--            Set, for a file or folder that belongs to a team -- and then
--            `user_id` is whoever uploaded it, not who may read it. Membership
--            decides that.
--
-- Distinct from `shared_drive_id`, which stays exactly as it is. That column
-- belongs to the older Shared Drives model the six iOS apps and the macOS
-- client still read, and this release does not reshape it. A row has at most
-- one of the two set; nothing yet writes both, and no query assumes it.
--
-- The `ON DELETE CASCADE` is deliberate but only ever reachable by a hard
-- delete: deleting a team through the API soft-deletes it (`teams.deleted_at`),
-- so the cascade does not fire and a team's files survive alongside it. It
-- matters if a row is ever purged for real — an admin cleanup, a rollback of
-- 00126 — and there it does the right thing to the rows and nothing at all to
-- the blobs, which are addressed by `files.storage_path` and would be left
-- behind. A purge path, when one exists, has to delete the bytes itself; that
-- is true of every other cascade into `files` and is not new here.
ALTER TABLE files ADD COLUMN team_id TEXT REFERENCES teams (id) ON DELETE CASCADE;
ALTER TABLE folders ADD COLUMN team_id TEXT REFERENCES teams (id) ON DELETE CASCADE;

-- A team's library is listed a folder at a time, live rows only. Partial on
-- `team_id IS NOT NULL` so the index costs nothing for the My Drive rows, which
-- are and will remain the overwhelming majority.
CREATE INDEX idx_files_team_folder
    ON files (team_id, folder_id, deleted_at) WHERE team_id IS NOT NULL;
CREATE INDEX idx_folders_team_parent
    ON folders (team_id, parent_id, deleted_at) WHERE team_id IS NOT NULL;
