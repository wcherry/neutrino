-- Add Curve25519 public key for end-to-end encryption.
-- Stored as base64url-encoded bytes.
ALTER TABLE users ADD COLUMN public_key TEXT;
