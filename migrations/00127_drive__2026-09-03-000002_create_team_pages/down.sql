-- Drop pages and their history.
--
-- Every team's wiki goes with this, including the Home page each team was
-- created with. There is nowhere else the markdown is kept, so this is not
-- recoverable from within the database.
DROP INDEX IF EXISTS idx_team_page_versions_page;
DROP INDEX IF EXISTS idx_team_page_versions_number;
DROP TABLE IF EXISTS team_page_versions;

DROP INDEX IF EXISTS idx_team_pages_tree;
DROP INDEX IF EXISTS idx_team_pages_one_home;
DROP INDEX IF EXISTS idx_team_pages_slug_live;
DROP TABLE IF EXISTS team_pages;
