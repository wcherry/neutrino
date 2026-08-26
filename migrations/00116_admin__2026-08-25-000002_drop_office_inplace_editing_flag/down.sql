-- Restore the flag row as 00098 created it, off by default.

DELETE FROM feature_flags WHERE key = 'officeInPlaceEditing';
INSERT INTO feature_flags (key, enabled, description, updated_at) VALUES
    ('officeInPlaceEditing', 0, 'In-place editing of MS Office docs (native round-trip + convert-on-open)', datetime('now'));
