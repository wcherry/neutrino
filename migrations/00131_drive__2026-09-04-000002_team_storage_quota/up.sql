-- Give every team a disk quota (#185, phase 1's "storage quotas").
--
-- `teams.storage_limit_bytes` has existed since 00126 and nothing has ever
-- written to it, so every team has been unlimited -- and the enforcement in
-- `teams::service` has been a branch that never ran. This is the other half:
-- new teams are created with the default, and the teams that already exist are
-- backfilled to the same number here.
--
-- **Why a backfill is safe, and why it would not have been.** Writing a limit
-- onto rows that have been running without one is exactly the kind of migration
-- that starts refusing uploads on a Monday morning. It is safe here for one
-- reason and it is worth stating rather than assuming: `teamSpaces` ships
-- disabled (00125) and has not been enabled on any deployment, so every row
-- this touches belongs to a team created by a developer with the flag turned on
-- by hand. If that stops being true before this ships, this statement has to
-- become a no-op and the quota has to arrive for existing teams by an
-- administrator setting it -- because 10 GiB is a guess about a team nobody has
-- looked at, and a guess is not something to enforce retroactively.
--
-- **NULL stays meaningful.** It is not "unset", it is *unlimited*, and an
-- administrator can choose it from the console's Teams tab. That is why the
-- column stays nullable and does not get a DEFAULT: a column default would make
-- "unlimited" unreachable through an INSERT that omits the field, which is
-- every INSERT the ORM writes.
--
-- The number is 10 GiB and it is also `DEFAULT_TEAM_QUOTA_BYTES` in
-- `src/drive/teams/quota.rs`. Two copies of one number is a drift waiting to
-- happen, so `the_backfilled_quota_matches_the_constant` runs the real
-- migrations and asserts they agree.
UPDATE teams
   SET storage_limit_bytes = 10737418240,
       updated_at = CURRENT_TIMESTAMP
 WHERE storage_limit_bytes IS NULL
   AND deleted_at IS NULL;

-- The admin console's Teams tab lists every live team ordered by how full it
-- is, because "which team is about to run out?" is the question that surface
-- exists to answer and scanning an unordered list is not an answer.
CREATE INDEX idx_teams_live_storage
    ON teams (storage_used_bytes DESC) WHERE deleted_at IS NULL;
