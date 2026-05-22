-- Stores the E2EE-encrypted metadata blob (JSON: title, mime_type, etc.)
-- encrypted with the file's DEK using XChaCha20-Poly1305.
-- Base64url-encoded. NULL for non-encrypted files.
ALTER TABLE files ADD COLUMN encrypted_metadata TEXT;
