-- The weekly email.
--
-- Once a week every account that has "General" or "Product updates" email on is sent one email:
-- what happened to it that week (shares, mentions, replies, action items, access requests,
-- storage), what happened in its Team Spaces, and the product updates an admin published that
-- week. Nothing is sent to an account with nothing to report.
--
-- `product_updates` are written by admins. A draft has no `published_at`; publishing stamps it,
-- and the weekly email carries every update published during its week.
--
-- `weekly_emails` records one row per account per week, inserted when that week is first considered
-- for the account and before anything is sent, so a restart or a second server instance never sends
-- the same week twice. `week` is the ISO week of the Monday it goes out,
-- e.g. `2026-W45`.
--
-- Purely additive.
CREATE TABLE product_updates (
    id           TEXT PRIMARY KEY NOT NULL,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL,
    created_by   TEXT NOT NULL,
    created_at   TIMESTAMP NOT NULL,
    updated_at   TIMESTAMP NOT NULL,
    published_at TIMESTAMP
);

CREATE INDEX idx_product_updates_published ON product_updates (published_at);

CREATE TABLE weekly_emails (
    user_id TEXT NOT NULL,
    week    TEXT NOT NULL,
    sent_at TIMESTAMP NOT NULL,
    PRIMARY KEY (user_id, week),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
