-- Dropping these columns re-enables every locked-out account and un-expires
-- every forced password: without the columns there is nothing to enforce.
ALTER TABLE users DROP COLUMN password_expired_at;
ALTER TABLE users DROP COLUMN password_changed_at;
ALTER TABLE users DROP COLUMN disabled_at;
