-- Dropping these forgets which addresses were proved; nothing is enforced without them.
DROP INDEX IF EXISTS idx_email_verifications_user_created;
DROP TABLE IF EXISTS email_verifications;
ALTER TABLE users DROP COLUMN email_verified_at;
