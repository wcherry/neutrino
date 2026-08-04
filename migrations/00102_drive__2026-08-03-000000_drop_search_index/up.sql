-- Server-side search has been removed: the index lives in the browser
-- (IndexedDB, see web/packages/search). Nothing writes these tables any more.
DROP INDEX IF EXISTS idx_fci_user;
DROP TABLE IF EXISTS file_content_index;
DROP TABLE IF EXISTS file_fts;
