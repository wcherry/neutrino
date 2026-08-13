-- Drop the `drawings` marker table.
--
-- The last of the five (after sheets 00106, docs 00107, slides 00108 and
-- diagrams 00109). Same pure marker: (file_id, created_at, updated_at),
-- duplicating columns on the `files` row it pointed at, existing only to
-- answer "is this file a drawing?" — which the file's mime type answers.
--
-- A file is now a native Neutrino drawing iff
-- `files.mime_type = 'application/x-neutrino-drawing'`; see
-- `src/drive/storage/native_types.rs`.
--
-- Drawings had no state beyond this row and no table referencing it, so the
-- whole `src/drawing` module goes with it — nothing about a drawing is
-- anything other than a Drive file.

DROP TABLE drawings;
