-- Encrypted client search-index snapshots.
--
-- The index itself lives in the browser (IndexedDB, see web/packages/search);
-- this table holds only the metadata for the encrypted blob a client uploads so
-- its other devices can restore rather than re-reading and re-decrypting every
-- document. The ciphertext is NOT stored here — it goes to the private store as
-- a hidden file (see `PrivateStore`), keeping a multi-megabyte blob out of the
-- row and off every metadata read.
--
-- One row per user: the snapshot is whole-database, so an upload replaces it.
-- `version` is the optimistic-concurrency token — a client sends the version it
-- last saw and the write is rejected unless it still matches, so a device with
-- a partial index cannot silently clobber a fuller one.
CREATE TABLE search_index_snapshots (
    user_id     TEXT PRIMARY KEY NOT NULL,
    -- Bumped by exactly 1 on every accepted upload. Clients send it back as
    -- `expectedVersion`; a mismatch is a 409 unless `force` is set.
    version     INTEGER NOT NULL DEFAULT 1,
    size_bytes  BIGINT NOT NULL,
    -- The snapshot's data key, sealed to the uploading user's own public key.
    -- The server never holds a key that opens it (same shape as file DEKs in
    -- `file_encryption_keys`).
    wrapped_key TEXT NOT NULL,
    -- Which device wrote this snapshot, so a client can recognise its own
    -- upload and skip the pointless round-trip of downloading it back.
    device_id   TEXT,
    updated_at  TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
