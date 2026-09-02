-- The workspace's password rules, set from the admin console.
--
-- A single row keyed 'default', for the same reason
-- `version_retention_settings` is: the policy is workspace-wide, so there is
-- nothing to look it up by, and a fixed key keeps a second policy from being
-- created by accident.
--
-- The rules are enforced wherever a password is *set* — self-serve
-- registration, an admin creating an account, and a password change — and
-- never retroactively against a stored hash, which cannot be inspected. The
-- one rule that reaches an existing password is `max_age_days`: sign-in
-- compares it against `users.password_changed_at`.
--
--   min_length         characters, never below the 8 the code has always
--                      required.
--   require_*          character classes the password must contain.
--   max_age_days       0 means passwords never expire on age. Any other value
--                      expires a password that many days after it was set.
CREATE TABLE password_policies (
    id TEXT NOT NULL PRIMARY KEY,
    min_length INTEGER NOT NULL DEFAULT 8,
    require_uppercase INTEGER NOT NULL DEFAULT 0,
    require_lowercase INTEGER NOT NULL DEFAULT 0,
    require_number INTEGER NOT NULL DEFAULT 0,
    require_symbol INTEGER NOT NULL DEFAULT 0,
    max_age_days INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seeded with exactly the rule the code enforced before this table existed, so
-- installing the migration changes nothing until an admin tightens it.
INSERT INTO password_policies
    (id, min_length, require_uppercase, require_lowercase, require_number, require_symbol, max_age_days)
VALUES ('default', 8, 0, 0, 0, 0, 0);
