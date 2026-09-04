-- Team Spaces (#185), phase 1: the Team object and its membership.
--
-- A Team is a top-level object in the same sense My Drive is: it owns its
-- members, its pages, its files, its activity and its storage, and everything
-- beneath it inherits its permissions. This is what `shared_drives` never was
-- -- that table names a container for files and nothing else, which is why a
-- team's charter, its onboarding page and its member list have had nowhere to
-- live. `shared_drives` is deliberately left in place and untouched: the six
-- iOS apps and the macOS client still read it, and this release is additive.
--
--   slug              a URL-stable name, unique across live teams. Renaming a
--                     team does not move it, so links into a team survive the
--                     rename -- the same reason page slugs exist in 00127.
--   visibility        'private' | 'invite_only' | 'organization'. Who can find
--                     the team, not what a member may do inside it; that is
--                     `team_members.role`.
--   storage_limit_bytes  NULL means "no team limit", which is the default. A
--                     team's usage is metered separately from its members' own
--                     quotas because the files belong to the team, not to
--                     whoever happened to upload them.
--   archived_at       archiving is not deleting: an archived team is read-only
--                     and hidden from the Shared Spaces list, and can be
--                     brought back. `deleted_at` is the soft delete, and only
--                     it makes the slug reusable.
--   settings_json     per-team preferences the product has not settled yet
--                     (default landing page, notification defaults). A JSON
--                     column here rather than a column per setting, so adding
--                     one is not a migration across a table clients read.
CREATE TABLE teams (
    id                  TEXT NOT NULL PRIMARY KEY,
    name                TEXT NOT NULL,
    slug                TEXT NOT NULL,
    description         TEXT,
    avatar_color        TEXT,
    avatar_emoji        TEXT,
    visibility          TEXT NOT NULL DEFAULT 'private',
    created_by          TEXT NOT NULL,
    default_page_id     TEXT,
    storage_used_bytes  BIGINT NOT NULL DEFAULT 0,
    storage_limit_bytes BIGINT,
    settings_json       TEXT,
    archived_at         TIMESTAMP,
    deleted_at          TIMESTAMP,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE CASCADE
);

-- Unique among live teams only. A deleted team's slug returns to the pool,
-- which a plain UNIQUE constraint would not allow.
CREATE UNIQUE INDEX idx_teams_slug_live ON teams (slug) WHERE deleted_at IS NULL;

-- The Shared Spaces list is read live-only, newest first.
CREATE INDEX idx_teams_deleted_created ON teams (deleted_at, created_at);

-- Who is in a team and what they may do there.
--
--   role     'owner' | 'admin' | 'editor' | 'contributor' | 'viewer' | 'guest',
--            the six roles in the phase 6 matrix. Stored as text rather than an
--            integer rank because the matrix is per-action, not a ladder: a
--            contributor may upload a file but not delete one, which no
--            ordering expresses.
--   user_email / user_name  denormalised the way `shared_drive_members` already
--            does it, so listing a team's members is one query and a member
--            list still renders for a user row that has since been removed.
CREATE TABLE team_members (
    id         TEXT NOT NULL PRIMARY KEY,
    team_id    TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    user_email TEXT NOT NULL,
    user_name  TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'viewer',
    added_by   TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- One membership per person per team. A second invitation is not a second
-- membership, it is a role change.
CREATE UNIQUE INDEX idx_team_members_unique ON team_members (team_id, user_id);

-- Both directions are hot: "who is in this team" for the Members tab, and
-- "which teams am I in" for the Shared Spaces list, which runs on every
-- navigation.
CREATE INDEX idx_team_members_user ON team_members (user_id);
