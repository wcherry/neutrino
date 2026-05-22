-- Stores per-user encrypted file keys (DEKs).
-- Each row holds a DEK encrypted with a specific user's Curve25519 public key
-- via crypto_box_seal (libsodium sealed box).
CREATE TABLE file_key_refs (
    id TEXT PRIMARY KEY NOT NULL,
    file_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    -- Base64url-encoded sealed-box ciphertext of the DEK.
    encrypted_file_key TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(file_id, user_id)
);
