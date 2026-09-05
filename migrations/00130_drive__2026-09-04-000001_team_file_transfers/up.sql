-- Team Spaces (#185): moving a personal file into a team, and sharing one with
-- a team without moving it.
--
-- Two capabilities, one switch, because they are two answers to the same
-- question -- "this file of mine should be the team's business" -- and a
-- deployment that offers one and not the other has a menu with half an idea on
-- it. The difference is what happens to ownership:
--
--   Move    the file leaves My Drive. `files.team_id` is set, and from that
--           moment the team owns it: `get_effective_role` reads membership and
--           stops, so the mover's own `owner` grant stops applying along with
--           everyone else's. Irreversible from the UI, which is why the move
--           reports how many existing shares it is about to make inert.
--   Share   the file stays in My Drive and stays the owner's. A row here says
--           the team's members may read (or edit) it, and the owner can take
--           that back without the file having moved anywhere.
--
-- Only the second needs a table. The first is `files.team_id`, added by 00128,
-- and the whole point of it is that a moved file is an ordinary team file with
-- no trace of where it came from.

-- The second feature flag, and the only one added since `teamSpaces`.
--
-- A second key needs an argument, because the reason there is one key and not
-- fifteen is that each of the fifteen had one. Here it is: the routes behind
-- this touch files that are *not* in a team -- a member's own My Drive -- which
-- no other Team Spaces route does. Team Spaces off means the team routes 404;
-- this off means a file in My Drive cannot be reached through a team at all,
-- which is a different blast radius and worth being able to close on its own,
-- with Team Spaces left running.
--
-- It is meaningless without `teamSpaces` and the service requires both, in that
-- order, so turning this on alone changes nothing.
INSERT INTO feature_flags (key, enabled, description, updated_at) VALUES
    ('teamFileTransfers', 0,
     'Moving a file from My Drive into a team''s library, and sharing one with a team without moving it. Requires teamSpaces. Owner: drive. Remove once both flows have run enabled in production for a full release cycle with no rollback.',
     datetime('now'));

-- A file the owner has lent to a team.
--
--   file_id     always a file with `team_id IS NULL` -- a personal file. A file
--               the team owns needs no row here, and a file another team owns
--               is not the sharer's to lend.
--   role        'viewer' | 'editor', in the Drive vocabulary rather than the
--               six team roles, because that is what `get_effective_role`
--               returns and what every existing reader of a file understands.
--               It is a ceiling for the whole team: a team Owner reading a
--               file shared as 'viewer' gets 'viewer', since authority over a
--               team is not authority over someone's personal file.
--   shared_by   the owner who lent it. Kept denormalised alongside the row for
--               the same reason `team_members` denormalises a name: the team's
--               shared list renders in one query and still says who lent a file
--               after that account is gone.
--
-- Deliberately not a `permissions` row with a team as its principal. That table
-- is (resource, user, role) throughout, every reader of it assumes a user id,
-- and a "user" whose id names a team would be a value that half the code
-- resolves to a person. It is also deliberately files only: a folder share
-- would have to interact with the inheritance walk in `get_effective_role`,
-- where the rule "a team share is more specific than an ancestor folder" stops
-- being obviously true.
CREATE TABLE team_file_shares (
    id         TEXT NOT NULL PRIMARY KEY,
    team_id    TEXT NOT NULL,
    file_id    TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'viewer',
    shared_by  TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
);

-- One share per file per team. Re-sharing at a different role is an update of
-- this row, not a second one, so a file cannot end up 'viewer' and 'editor' to
-- the same team with the answer decided by row order.
CREATE UNIQUE INDEX idx_team_file_shares_team_file
    ON team_file_shares (team_id, file_id);

-- The read on the hot path: `get_effective_role` asks "is this file shared with
-- any team the caller is in?" for a file it is about to serve, so the lookup is
-- by file first.
CREATE INDEX idx_team_file_shares_file ON team_file_shares (file_id);

-- The team's own list of what has been lent to it.
CREATE INDEX idx_team_file_shares_team ON team_file_shares (team_id, created_at);
