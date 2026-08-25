-- Recreate `docs` as 00107 left it.
--
-- Restored empty. The rows cannot be reconstructed: page setup is written into
-- the document body now, and reading it back out means decrypting the body,
-- which the server has no key for.

CREATE TABLE IF NOT EXISTS docs (
    file_id    TEXT PRIMARY KEY NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    page_setup TEXT NOT NULL
);
