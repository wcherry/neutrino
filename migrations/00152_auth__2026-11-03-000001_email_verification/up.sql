-- Email verification.
--
-- A new account is mailed a single-use link that proves it owns its address. Until it does, the
-- web app shows a banner; where verification is enforced, sharing and password reset wait for it,
-- and an account still unverified 30 days after it was created cannot sign in until it verifies.
--
-- `users.email_verified_at` is when the address was proved. Every account that exists before this
-- migration is counted as verified at its creation time: none of them were ever asked to, and
-- blocking them would lock out every current user.
--
-- `email_verifications` holds the links, one row per email sent. Only the SHA-256 of each token
-- is stored. `email` is the address the link was sent to, so a link can never verify an address
-- the account no longer has. The (user_id, created_at) index serves the hourly resend cap.
--
-- Additive: the column is nullable and nothing existing reads it.
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMP;
UPDATE users SET email_verified_at = created_at;

CREATE TABLE email_verifications (
    id         TEXT PRIMARY KEY NOT NULL,
    user_id    TEXT NOT NULL,
    email      TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used_at    TIMESTAMP,
    revoked_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_email_verifications_user_created ON email_verifications (user_id, created_at);
