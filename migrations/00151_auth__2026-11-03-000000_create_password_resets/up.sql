-- Self-serve password reset ("Forgot password?").
--
-- Asking for a reset emails a single-use link to the account's address. The link works once and
-- expires an hour after it was sent; asking again revokes any earlier link that is still live, so
-- only the newest one in the inbox works. A successful reset revokes every other live link too.
--
-- Only the SHA-256 of each token is stored; the token itself appears only in the email.
--
-- The (user_id, created_at) index serves the rolling one-hour count behind the per-account cap,
-- which stops the form being used to flood someone's inbox.
--
-- Purely additive.
CREATE TABLE password_resets (
    id         TEXT PRIMARY KEY NOT NULL,
    user_id    TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used_at    TIMESTAMP,
    revoked_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_password_resets_user_created ON password_resets (user_id, created_at);
