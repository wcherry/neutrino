-- No feature is behind a flag while Neutrino is in beta: flags are for after a stable public
-- release. Every feature these four gated is now unconditional, and the code that read them is
-- gone (`src/drive/feature_flags/catalog.rs` declares none). The table, the endpoints and the admin
-- tab stay, so a flag can be added again after the release.
--
-- e2eeChunkedWrites: the server never read it. The Drive iOS app reads it and treats a missing key
-- as off, so it keeps writing the pre-NEB1 format until that app is changed.
DELETE FROM feature_flags
WHERE key IN ('teamSpaces', 'teamFileTransfers', 'e2eeChunkedWrites', 'folderLinkEditing');
