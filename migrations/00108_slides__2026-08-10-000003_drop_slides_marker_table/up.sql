-- Drop the `slides` marker table.
--
-- Identical in shape and purpose to the `sheets` marker dropped in 00106: the
-- row held only (file_id, created_at, updated_at), duplicating columns on the
-- `files` row it pointed at, and existed only to answer "is this file a
-- presentation?" — which the file's mime type already answers.
--
-- A file is now a native Neutrino presentation iff
-- `files.mime_type = 'application/x-neutrino-slide'`; see
-- `src/drive/storage/native_types.rs`.
--
-- Nothing references this table (`slide_themes` is keyed by user, not by
-- file), so unlike `sheets` there is no foreign key to rebuild first.

DROP TABLE slides;
