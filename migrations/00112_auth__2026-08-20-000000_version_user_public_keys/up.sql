-- Versioned identity keys, so a user can rotate without losing what they wrote
-- under the old one.
--
-- Until now a user had exactly one Curve25519 identity: `users.public_key`, a
-- single column that `POST /api/v1/auth/keys` overwrote in place. That makes
-- rotation destructive — the moment the column changes, every DEK in
-- `file_key_refs` is sealed to a key nobody advertises any more, and the only
-- record of which key a given row needs is gone.
--
-- The fix is to stop treating the identity as one value and start treating it
-- as a keyring:
--
--   user_public_keys      every version the user has ever published, one row
--                         each, exactly one of them active
--   file_key_refs.key_version
--                         which of those versions a row's DEK is sealed to
--
-- Reading a file resolves `key_version` against the local keyring and uses that
-- version's secret key. Writing re-seals to whichever version is active and
-- records the new number. Content is never re-encrypted: only the sealed DEK
-- moves, so rotation is O(number of key refs touched), not O(bytes stored).
--
-- Secret keys are not here and never will be. This table holds public halves
-- only — the directory a collaborator consults to seal a DEK to someone. See
-- `agent_docs/client-only-key-architecture.md`.

CREATE TABLE user_public_keys (
    user_id     TEXT NOT NULL,
    -- 1-based, ascending, gapless. Assigned by the server on publish so two
    -- devices racing to rotate cannot both claim the same number.
    version     INTEGER NOT NULL,
    -- base64url Curve25519 public key.
    public_key  TEXT NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- NULL means this is the version new work is sealed to. Set when a later
    -- version supersedes it; the row itself is never deleted, because files
    -- sealed to it stay readable and need to know which key they want.
    retired_at  TIMESTAMP,
    PRIMARY KEY (user_id, version),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Exactly one active version per user, enforced here rather than in application
-- code: publishing is a two-statement operation (retire the old, insert the
-- new) and a crash between them would otherwise leave a user with two active
-- keys and no way for a collaborator to tell which one to seal to.
CREATE UNIQUE INDEX idx_user_public_keys_active
    ON user_public_keys(user_id) WHERE retired_at IS NULL;

-- Carry the existing single key across as version 1. Users with a NULL
-- `public_key` have never set up encryption and get no row, which is the same
-- "no key published" state the sharing path already handles.
INSERT INTO user_public_keys (user_id, version, public_key)
SELECT id, 1, public_key FROM users WHERE public_key IS NOT NULL;

-- `users.public_key` is deliberately left in place and kept in step with the
-- active version. It is read by paths that predate this table and only ever
-- want "the current key"; making them all join here buys nothing.

-- Every existing row was sealed to the one identity that existed before this
-- migration, which is now version 1 — so the default is right for the whole
-- back catalogue and no backfill statement is needed.
ALTER TABLE file_key_refs ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1;
