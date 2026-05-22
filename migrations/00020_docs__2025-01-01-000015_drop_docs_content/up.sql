-- Content is now stored in drive (filesystem), not in the docs database.
ALTER TABLE docs DROP COLUMN content;
