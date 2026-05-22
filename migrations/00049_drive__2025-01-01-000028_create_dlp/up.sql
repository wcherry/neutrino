CREATE TABLE dlp_rules (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    pattern TEXT NOT NULL,
    pattern_type TEXT NOT NULL,
    action TEXT NOT NULL,
    severity TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE dlp_violations (
    id TEXT PRIMARY KEY NOT NULL,
    file_id TEXT NOT NULL,
    rule_id TEXT NOT NULL REFERENCES dlp_rules(id),
    matched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notified_at TIMESTAMP,
    action_taken TEXT,
    dismissed_at TIMESTAMP,
    dismissed_by TEXT
);

CREATE INDEX idx_dlp_violations_file ON dlp_violations(file_id);
CREATE INDEX idx_dlp_violations_rule ON dlp_violations(rule_id);
