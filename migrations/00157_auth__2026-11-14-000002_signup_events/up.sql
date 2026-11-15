-- Sign-up events: one row per account created through public sign-up, recording where it came from.
--
-- Backs the sign-up abuse guard (`src/auth/signup_guard/`): the per-IP and server-wide sign-up
-- limits count these rows, and the admin console groups and bulk-deletes accounts by `ip`.
-- A row is written before the account is created, as a reservation (`user_id` NULL), and is
-- removed again if registration fails, so concurrent requests cannot slip past a limit together.
--
-- `human_verified` is 1 when the sign-up passed a CAPTCHA or spent a valid invite; requests
-- without either (the native apps today, and scripts) get a much tighter limit.
--
-- Additive: a new table nothing existing reads. Accounts created before it have no row.
CREATE TABLE signup_events (
    id             TEXT PRIMARY KEY NOT NULL,
    user_id        TEXT,
    ip             TEXT NOT NULL,
    email_domain   TEXT NOT NULL,
    human_verified INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMP NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_signup_events_ip_created ON signup_events (ip, created_at);
CREATE INDEX idx_signup_events_created ON signup_events (created_at);
CREATE INDEX idx_signup_events_user ON signup_events (user_id);
