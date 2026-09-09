-- Put the column back, empty.
--
-- The thumbnails themselves are not restored: they are in the file store now,
-- and moving them back would mean base64-encoding every blob, which SQL cannot
-- do either. A rolled-back server therefore reads a null column and shows the
-- icon instead of a picture; the store still holds every `.thumb`, so rolling
-- forward again restores them.

ALTER TABLE files ADD COLUMN cover_thumbnail TEXT;
