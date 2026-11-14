-- The third feature flag: whether clients write file bodies in the chunked NEB1 format
-- (agent_docs/chunked-file-encryption.md, #318).
--
-- The argument a new key owes (see `src/drive/feature_flags/catalog.rs`): this is not a phase of a
-- feature, it is a wire-format switch. Turning it on makes clients write files that a build without
-- the NEB1 reader cannot open, on every device the user has — and an installed native app cannot be
-- recalled the way a web deploy can. The spec's rollout (§10) depends on being able to stop new NEB1
-- writes without a release, and on readers shipping everywhere before the first write. Off stops
-- new NEB1 bodies; it does not, and cannot, un-write existing ones, which every reader keeps opening.
--
-- Read by every client that writes NEB1, and effective only in a build that can also read it.
INSERT INTO feature_flags (key, enabled, description, updated_at) VALUES
    ('e2eeChunkedWrites', 0,
     'Clients write encrypted file bodies in the chunked NEB1 format, so large files encrypt in constant memory. Turn on only once every client in use can read NEB1. Off stops new NEB1 files; existing ones stay readable. Owner: crypto. Remove once NEB1 has been the default in every client for a full release cycle with no rollback.',
     datetime('now'));
