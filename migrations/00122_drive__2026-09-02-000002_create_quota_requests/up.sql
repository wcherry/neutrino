-- A user's request for more storage than their quota allows (issue #144).
--
-- The storage meter's "Request Additional" link writes a row here; the admin
-- console's Work Queue reads the pending ones and an admin approves or denies
-- each. Approving is what writes `user_quotas.quota_bytes` — this table is the
-- record of the ask and the decision, never the limit itself, so a quota
-- changed by hand afterwards does not have to be reconciled with it.
--
--   requested_bytes  the new total limit asked for, not an increment, so the
--                    row still means the same thing after the quota moves.
--   granted_bytes    what the admin actually gave. NULL until approved, and it
--                    may differ from `requested_bytes` — an admin can approve a
--                    smaller amount than was asked for.
--   status           'pending' | 'approved' | 'denied'. One pending row per
--                    user at a time, enforced by the partial index below rather
--                    than by a check in the handler.
CREATE TABLE quota_requests (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL,
    requested_bytes BIGINT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    granted_bytes BIGINT,
    decision_note TEXT,
    decided_by TEXT,
    decided_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- A second pending ask from the same person is not a second request, it is the
-- same one sent twice — usually because the first has not been looked at yet.
CREATE UNIQUE INDEX idx_quota_requests_one_pending_per_user
    ON quota_requests (user_id) WHERE status = 'pending';

-- The queue is read pending-first, oldest-first.
CREATE INDEX idx_quota_requests_status_created ON quota_requests (status, created_at);
