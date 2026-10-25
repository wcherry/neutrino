-- Friend invites (onboarding phase 5).
--
-- A signed-in user invites people two ways. An emailed invite goes to one address, works once and
-- expires 14 days after it was sent. A personal link (kind 'link') is meant for a group chat: it can
-- be used by several people until it expires 14 days after it was minted, or until its owner resets
-- it, which revokes this row and mints a new one. Signing up through either works even when the
-- deployment sets PUBLIC_SIGNUP=closed.
--
-- Only the SHA-256 of each token is stored. An emailed token is random and appears only in the
-- email; a personal link's token is an HMAC of the row id, so the server can show it again without
-- keeping it.
--
-- accepted_at is when an emailed invite was used, or when a personal link was last used;
-- accepted_user_id is who signed up with it. The (inviter_id, kind, created_at) index serves the
-- sent list and the rolling 24-hour count behind the daily cap.
--
-- Purely additive.
CREATE TABLE invites (
    id               TEXT PRIMARY KEY NOT NULL,
    inviter_id       TEXT NOT NULL,
    kind             TEXT NOT NULL CHECK (kind IN ('email', 'link')),
    token_hash       TEXT NOT NULL UNIQUE,
    invitee_email    TEXT,
    note             TEXT,
    created_at       TIMESTAMP NOT NULL,
    expires_at       TIMESTAMP NOT NULL,
    accepted_at      TIMESTAMP,
    accepted_user_id TEXT,
    revoked_at       TIMESTAMP,
    use_count        INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (inviter_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (accepted_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_invites_inviter_kind_created ON invites (inviter_id, kind, created_at);
