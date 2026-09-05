-- Team Spaces (#185): asking to join an invite-only team.
--
-- `teams.visibility` decides who can *find* a team and what a non-member may do
-- about it:
--
--   private       not discoverable. A non-member gets 404 on every route,
--                 including the discovery listing -- whether the team exists is
--                 itself something membership decides.
--   organization  discoverable, and a signed-in user adds themselves. No row is
--                 written here; the join is immediate.
--   invite_only   discoverable, and a signed-in user *asks*. That ask is a row
--                 in this table, and an Owner or Admin approves or declines it.
--
-- So this table exists for exactly one of the three, and the two discoverable
-- values differ only in whether joining needs someone's agreement.
--
--   status        'pending' | 'approved' | 'declined'. Decided requests are kept
--                 rather than deleted: an approval is the provenance of a
--                 membership, and a decline is what stops the same person
--                 reappearing in the queue every day without anyone knowing they
--                 were already turned down.
--   user_email /
--   user_name     denormalised exactly as `team_members` does it, so the pending
--                 queue renders in one query and still reads correctly after the
--                 requester's account is gone.
--   message       optional, the requester's own words. An admin approving a
--                 request for a name they do not recognise has nothing else to
--                 go on.
--   decided_by /
--   decided_at    who answered and when. NULL exactly while status is 'pending'.
CREATE TABLE team_join_requests (
    id         TEXT NOT NULL PRIMARY KEY,
    team_id    TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    user_email TEXT NOT NULL,
    user_name  TEXT NOT NULL,
    message    TEXT,
    status     TEXT NOT NULL DEFAULT 'pending',
    decided_by TEXT,
    decided_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- One *open* request per person per team. Partial rather than a plain UNIQUE on
-- (team_id, user_id): someone declined last quarter may ask again, and someone
-- approved, later removed, may ask again -- but nobody may have two requests in
-- the queue at once.
CREATE UNIQUE INDEX idx_team_join_requests_open
    ON team_join_requests (team_id, user_id)
    WHERE status = 'pending';

-- The admin queue: this team's pending requests, oldest first.
CREATE INDEX idx_team_join_requests_team_status
    ON team_join_requests (team_id, status, created_at);

-- The requester's own view: the Discover list marks a team as already asked
-- for, so it renders "Requested" rather than offering the button again.
CREATE INDEX idx_team_join_requests_user_status
    ON team_join_requests (user_id, status);
