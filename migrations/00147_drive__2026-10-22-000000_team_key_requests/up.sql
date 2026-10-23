-- Asking a team for a file's key (UI roadmap stage 6, "members who join later").
--
-- A team file is encrypted on the device, and its key is sealed to each member separately when it
-- is uploaded, moved or lent into the team. Someone who joins afterwards can see the file in the
-- listing and cannot open it: no server-side step can give them the key, because the plaintext key
-- exists only in the browser of someone who already holds it. So they ask. The team's Owners and
-- Admins, and the file's owner, see the request; whichever of them answers it first seals the key
-- to the requester in their own browser and approves, or declines with an optional reason.
--
-- One pending request per person per file per team (the partial unique index). Answered rows are
-- kept so the requester can see the answer and the reason.
--
-- Purely additive.
CREATE TABLE team_key_requests (
    id           TEXT PRIMARY KEY NOT NULL,
    team_id      TEXT NOT NULL,
    file_id      TEXT NOT NULL,
    requester_id TEXT NOT NULL,
    message      TEXT,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
    reason       TEXT,
    decided_by   TEXT,
    decided_at   TIMESTAMP,
    created_at   TIMESTAMP NOT NULL,
    updated_at   TIMESTAMP NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_team_key_requests_one_pending
    ON team_key_requests (team_id, file_id, requester_id)
    WHERE status = 'pending';

CREATE INDEX idx_team_key_requests_team_status ON team_key_requests (team_id, status);
