-- Collapse the keyring back to a single identity per user.
--
-- This is lossy in a way no down migration can avoid: if any user has rotated,
-- their earlier versions are dropped and every `file_key_refs` row sealed to
-- one of them becomes unreadable, because nothing is left to say which key it
-- wanted. `users.public_key` already holds the active version, so files sealed
-- to *that* survive.
--
-- Safe to run only on a database where nobody has rotated yet.

ALTER TABLE file_key_refs DROP COLUMN key_version;

DROP INDEX IF EXISTS idx_user_public_keys_active;
DROP TABLE IF EXISTS user_public_keys;
