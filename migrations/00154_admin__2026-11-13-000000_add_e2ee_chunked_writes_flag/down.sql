-- NEB1 files already written stay NEB1: every reader keeps opening them.
DELETE FROM feature_flags WHERE key = 'e2eeChunkedWrites';
