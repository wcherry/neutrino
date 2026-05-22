CREATE TABLE training_signals (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL,
    face_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('accepted', 'rejected')),
    processed INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_training_signals_user_id ON training_signals(user_id);
CREATE INDEX idx_training_signals_processed ON training_signals(processed);
