-- Envelope storage for the user's Curve25519 identity key.
--
-- Before this migration the secret key existed only as plaintext in one
-- browser's localStorage, which made it both stealable off disk and impossible
-- to carry to a second device — the iOS client asks people to paste a key
-- bundle in by hand for exactly this reason.
--
-- The scheme is two-level:
--
--   identity secret key  ──encrypted under──▶  master key (MK, 32 random bytes)
--   MK                   ──encrypted under──▶  one key per unlock method
--
-- The server stores the wrapped identity once, plus one wrapped copy of MK per
-- way the user can unlock (password, passkey, recovery code). MK itself is
-- never stored and never transmitted. Because every method wraps the *same* MK,
-- enrolling a new device or revoking a lost one touches a single row and never
-- re-keys the identity — so no `file_key_refs` row has to be rewritten.
--
-- Everything in both tables is opaque ciphertext to the server. It can hand the
-- blobs back but holds nothing that opens them.
CREATE TABLE user_key_vaults (
    user_id            TEXT PRIMARY KEY NOT NULL,
    -- base64url( 24-byte secretbox nonce || XSalsa20-Poly1305 ciphertext of the
    -- 32-byte Curve25519 secret key ), keyed by MK.
    encrypted_identity TEXT NOT NULL,
    -- The matching Curve25519 public key, base64url. Mirrored from
    -- `users.public_key` so a client can confirm it unwrapped the right secret
    -- before trusting it, and so vault reads need no second query.
    public_key         TEXT NOT NULL,
    -- Envelope format version, bumped if the wrapping scheme ever changes.
    version            INTEGER NOT NULL DEFAULT 1,
    created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- One row per enrolled unlock method. Each holds the same MK wrapped under a
-- different key-encryption key.
CREATE TABLE user_key_unlocks (
    id                   TEXT PRIMARY KEY NOT NULL,
    user_id              TEXT NOT NULL,
    -- 'password' | 'passkey' | 'recovery'
    method               TEXT NOT NULL,
    -- User-facing name, e.g. "iPhone passkey". Shown in settings so a lost
    -- device can be identified and revoked.
    label                TEXT NOT NULL,
    -- base64url( nonce || ciphertext of the 32-byte MK ).
    encrypted_master_key TEXT NOT NULL,
    -- JSON, method-specific and client-interpreted:
    --   password/recovery — {"kdf":"argon2id","salt":…,"ops":…,"mem":…}
    --   passkey           — {"credentialId":…,"prfSalt":…}
    -- The passkey PRF secret lives in the authenticator, so `credentialId` and
    -- `prfSalt` are inputs to the derivation, not the key itself.
    params               TEXT NOT NULL,
    created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at         TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_user_key_unlocks_user ON user_key_unlocks(user_id);

-- A user may enrol many passkeys (one per device) but only one password and one
-- recovery code — re-adding either replaces the existing row.
CREATE UNIQUE INDEX idx_user_key_unlocks_singleton
    ON user_key_unlocks(user_id, method)
    WHERE method IN ('password', 'recovery');
