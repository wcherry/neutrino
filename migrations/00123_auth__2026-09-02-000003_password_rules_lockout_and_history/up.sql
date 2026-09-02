-- Three more rules on the workspace password policy, plus the per-account state
-- the two of them that reach an *existing* account need to work.
--
--   forbidden_characters  characters a password may not contain, stored as the
--                         characters themselves rather than as a delimited list.
--                         A comma, a space and a semicolon are all plausible
--                         things to forbid, so any delimiter would be ambiguous
--                         about whether it was the separator or the rule. Empty
--                         — the seeded value — forbids nothing.
--
--   lockout_threshold     consecutive failed sign-ins before the account stops
--                         accepting its own password. 0 means no lockout, which
--                         is what every workspace has had until now.
--
--   history_count         how many of an account's previous passwords a new one
--                         is checked against. 0 disables the check.
ALTER TABLE password_policies ADD COLUMN forbidden_characters TEXT NOT NULL DEFAULT '';
ALTER TABLE password_policies ADD COLUMN lockout_threshold INTEGER NOT NULL DEFAULT 0;
ALTER TABLE password_policies ADD COLUMN history_count INTEGER NOT NULL DEFAULT 0;

-- Lockout is counted per account, so the count lives on the account.
--
--   failed_login_attempts  consecutive sign-ins that got the password wrong.
--                          Reset to 0 by a sign-in that gets it right, so a
--                          typo on Monday and a typo on Friday are not the same
--                          run of failures.
--
--   locked_out_at          when the run reached the threshold. NULL normally.
--                          Deliberately *not* `disabled_at`: an admin disabled
--                          an account on purpose and only an admin should undo
--                          that, whereas a lockout was applied by a counter and
--                          is cleared by Unlock — folding them together would
--                          make an automatic lock indistinguishable from a
--                          deliberate one in the console.
ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_out_at TIMESTAMP;

-- Previous passwords, as Argon2 hashes and nothing else — the reuse rule can
-- only ever be "does this candidate verify against one of these", because a
-- hash cannot be read back into the password that made it.
--
-- Rows are trimmed to a fixed cap rather than to the policy's current
-- `history_count`, so raising the count later still has something to check
-- against instead of silently starting over.
CREATE TABLE password_history (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_password_history_user ON password_history(user_id, created_at);
