-- Documents table: stores rich-text doc content (TipTap ProseMirror JSON)
-- file_id is a FK to files.id — each doc is also a files entry with
-- mime_type = 'application/x-neutrino-doc' and storage_path = ''
CREATE TABLE docs (
    file_id    TEXT PRIMARY KEY NOT NULL,
    content    TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}',
    page_setup TEXT NOT NULL DEFAULT '{"marginTop":72,"marginBottom":72,"marginLeft":72,"marginRight":72,"orientation":"portrait","pageSize":"letter"}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
