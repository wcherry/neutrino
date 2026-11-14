-- Restores the rows, switched off. Rolling back the code as well is what makes them mean anything.
INSERT OR IGNORE INTO feature_flags (key, enabled, description, updated_at) VALUES
    ('teamSpaces', 0, 'Team Spaces. Owner: drive.', datetime('now')),
    ('teamFileTransfers', 0, 'Moving and sharing personal files into a team. Owner: drive.', datetime('now')),
    ('e2eeChunkedWrites', 0, 'Clients write encrypted file bodies as NEB1. Owner: crypto.', datetime('now')),
    ('folderLinkEditing', 0, 'Anyone with a folder link can read and write inside it. Owner: drive.', datetime('now'));
