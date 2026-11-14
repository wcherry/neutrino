DELETE FROM feature_flags WHERE key = 'folderLinkEditing';
DELETE FROM file_key_refs WHERE user_id LIKE 'guest:%';
ALTER TABLE share_links DROP COLUMN sealed_seed_key_version;
ALTER TABLE share_links DROP COLUMN sealed_seed;
ALTER TABLE share_links DROP COLUMN public_key;
ALTER TABLE share_links DROP COLUMN session_epoch;
ALTER TABLE share_links DROP COLUMN password_hash;
