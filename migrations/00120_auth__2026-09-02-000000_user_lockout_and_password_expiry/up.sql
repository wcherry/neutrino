-- Give an account two states it could not have before: locked out, and holding
-- a password that is no longer good enough to sign in with.
--
--   disabled_at          when an admin locked the account out. NULL for a live
--                        account. Deliberately *not* `deleted_at`: a disabled
--                        account is still listed, still owns its files, and is
--                        re-enabled by clearing this column, whereas a deleted
--                        one is invisible everywhere and on a purge clock.
--
--   password_changed_at  when the password was last set. NULL for every account
--                        that predates this, which the age check reads as
--                        "unknown, so not yet expired" rather than as the epoch
--                        — the latter would expire every existing account the
--                        moment an admin first sets a maximum age.
--
--   password_expired_at  when an admin forced the password to expire. NULL
--                        normally. Set, it refuses sign-in with PASSWORD_EXPIRED
--                        until the user sets a new password; a policy-driven
--                        expiry (see 00121) is computed from
--                        `password_changed_at` instead and leaves this NULL.
--
-- Sign-in checks all of this *after* verifying the password, so neither state
-- can be used to probe whether an address has an account.

ALTER TABLE users ADD COLUMN disabled_at TIMESTAMP;
ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMP;
ALTER TABLE users ADD COLUMN password_expired_at TIMESTAMP;

-- Every account that exists right now has a password of unknown age. Stamping
-- them with their creation date is the honest reading and keeps a maximum-age
-- policy meaningful for them, rather than exempting them forever.
UPDATE users SET password_changed_at = created_at WHERE password_changed_at IS NULL;
