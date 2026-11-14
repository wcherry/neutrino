-- Folder link sharing (#321): optional password, a link key for end-to-end encryption, and guest
-- sessions that die with the link.
--
-- `password_hash`  Argon2id PHC string; NULL means the link needs no password.
-- `session_epoch`  bumped whenever the password is set, changed or removed. A guest session's
--                  subject is `guest:{link id}:{epoch}`, so bumping it ends every session issued
--                  before the change.
-- `public_key`     base64url X25519 public half of the link key pair. The private half lives only
--                  in the link's URL fragment; file DEKs are sealed to this key as `file_key_refs`
--                  rows whose user_id is `guest:{link id}`.
ALTER TABLE share_links ADD COLUMN password_hash TEXT;
ALTER TABLE share_links ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE share_links ADD COLUMN public_key TEXT;
-- `sealed_seed`    the link key's seed sealed (crypto_box_seal) to the owner's public key, so the
--                  owner's browser can rebuild the full link, fragment included, to copy it again.
--                  Opaque to the server, like any sealed DEK.
-- `sealed_seed_key_version`  which version of the owner's keyring opens it.
ALTER TABLE share_links ADD COLUMN sealed_seed TEXT;
ALTER TABLE share_links ADD COLUMN sealed_seed_key_version INTEGER;

-- Guest sessions used to write a `guest:{token}` permission row that nothing ever removed, so a
-- disabled, deleted or expired link kept granting its role. A guest's role is now derived from the
-- live share_links row on every request, and these rows grant nothing anyone should still hold.
DELETE FROM permissions WHERE user_id LIKE 'guest:%';

INSERT INTO feature_flags (key, enabled, description, updated_at) VALUES
    ('folderLinkEditing', 0,
     'Anyone with a folder''s link (and its password, if set) can browse, upload, rename, move and trash inside it, end-to-end encrypted with a key carried in the link. Off hides the guest folder API and the folder link UI; existing links keep their view-only behaviour. Owner: drive. Remove once folder links have run enabled for a release cycle with every client sealing new uploads to key-recipients.',
     datetime('now'));
