-- Organisation and team preferences (agent_docs/ui-customization-roadmap.md §3.1–3.2, §5, §6.2).
--
-- The layers under a user's own choice. Resolution, most specific first, with the org lock on top:
--
--     org lock ─► device ─► user ─► team (in a team context) ─► org default ─► product default
--
-- `org_preferences` is the instance's: one row per key an administrator has given a default, and
-- `locked` pins it — a locked key ignores whatever the user set, and the server refuses a user
-- write to it. There is one organisation per instance, so the table has no org column. Written
-- only through `/api/v1/admin/preferences` (`AdminUser`).
--
-- `team_preferences` is a team's defaults, applied inside that team's space; a member's own choice
-- still wins (a team default is a starting point, not a policy). Written by the team's Owners and
-- Admins (`TeamAction::ManageSettings`).
--
-- Values are JSON text, validated against the catalog (src/preferences/catalog.rs) on every write
-- and only for keys whose scopes include `org` or `team`. Purely additive: no client running an
-- older build reads these tables, and a user's own rows are untouched.
CREATE TABLE org_preferences (
    key        TEXT PRIMARY KEY NOT NULL,
    value      TEXT NOT NULL,
    locked     BOOLEAN NOT NULL DEFAULT 0,
    updated_by TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE team_preferences (
    team_id    TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    updated_by TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (team_id, key),
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);
