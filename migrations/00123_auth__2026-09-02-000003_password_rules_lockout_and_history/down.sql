-- Dropping these releases every locked-out account and forgets every previous
-- password: without the columns and the table there is nothing to enforce.
DROP INDEX IF EXISTS idx_password_history_user;
DROP TABLE IF EXISTS password_history;

ALTER TABLE users DROP COLUMN locked_out_at;
ALTER TABLE users DROP COLUMN failed_login_attempts;

ALTER TABLE password_policies DROP COLUMN history_count;
ALTER TABLE password_policies DROP COLUMN lockout_threshold;
ALTER TABLE password_policies DROP COLUMN forbidden_characters;
