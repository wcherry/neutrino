-- Indexes for the folder-contents listing (`GET /api/v1/drive/folders/{id}`).
--
-- The listing filters on `(user_id, folder_id)` with `deleted_at IS NULL` and
-- orders by one of three columns. The only candidates were the single-column
-- `idx_files_user_id` and `idx_files_folder_id`, neither of which can answer
-- the ORDER BY, so every plan ended in `USE TEMP B-TREE FOR ORDER BY`: SQLite
-- had to materialise every row in the folder before `LIMIT` could discard
-- most of them.
--
-- That is ruinous on this table specifically, because `files.cover_thumbnail`
-- holds a base64 thumbnail — up to ~100KB a row, and ~88% of the whole
-- database — so a listing that returns 6KB of JSON could spend twenty seconds
-- dragging tens of megabytes of thumbnail through the page cache (issue #147,
-- reported against a drive holding a Google Takeout import).
--
-- Each index carries the sort column as its last component so the ORDER BY is
-- answered by walking the index, which lets LIMIT stop the scan before the
-- discarded rows — and their thumbnails — are touched at all. Hence one index
-- per sort field rather than a single `(user_id, folder_id)` index: sharing
-- one would put the temp b-tree back, which is the cost being removed here.
--
-- They are partial on `deleted_at IS NULL` because that is what every listing
-- asks for; trashed rows have their own path and are left out of the b-tree.
CREATE INDEX idx_files_folder_listing_name
    ON files(user_id, folder_id, name) WHERE deleted_at IS NULL;
CREATE INDEX idx_files_folder_listing_updated_at
    ON files(user_id, folder_id, updated_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_files_folder_listing_created_at
    ON files(user_id, folder_id, created_at) WHERE deleted_at IS NULL;

-- Subfolders get one index, not three. The same plan applies, but a folder row
-- is metadata only and a few hundred bytes, so a temp b-tree over the ones in
-- a folder stays cheap; what matters is that `(user_id, parent_id)` keeps the
-- scan off the rest of the drive.
CREATE INDEX idx_folders_parent_listing_name
    ON folders(user_id, parent_id, name) WHERE deleted_at IS NULL;
