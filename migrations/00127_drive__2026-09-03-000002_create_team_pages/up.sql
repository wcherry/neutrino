-- Team Spaces (#185), phases 2 and 3: Page as a first-class object.
--
-- A page is deliberately not a Docs document. The alternative considered in the
-- issue -- wiki pages as `.docx`-shaped rows in a shared folder -- would have
-- reused the Docs editor, but it gives up the page tree, the slug, per-page
-- permissions and wiki-specific search, and it couples the wiki to a document
-- format that has its own reasons to change. So pages get their own table, with
-- markdown as the content and a parent pointer as the structure.
--
--   parent_page_id  NULL for a top-level page. The tree is materialised on read
--                   rather than stored as a path, so moving a subtree is one
--                   UPDATE. Cycles are rejected in the service, not here --
--                   SQLite cannot express the constraint.
--   slug            unique per team among live pages, so /teams/<slug>/<slug>
--                   survives a rename the same way the team's own does.
--   content_md      the page body, markdown. Held in the row rather than in
--                   object storage because a page is small, is read on every
--                   navigation, and has to be searchable by content.
--   is_home         exactly one per team, the page a team is created with and
--                   the one it opens on. Enforced by the partial unique index
--                   below rather than by a check in the handler, and it is why
--                   deleting the Home page is refused: the index would let a
--                   team have none.
--   sort_order      manual ordering among siblings. Ties break on title.
--   published       an unpublished page is visible to its author and to admins
--                   only -- the draft state phase 3 needs before comments and
--                   notifications exist to make sharing a draft meaningful.
--   deleted_at      soft delete. A deleted page keeps its children, which are
--                   deleted with it and restored with it.
CREATE TABLE team_pages (
    id             TEXT NOT NULL PRIMARY KEY,
    team_id        TEXT NOT NULL,
    parent_page_id TEXT,
    title          TEXT NOT NULL,
    slug           TEXT NOT NULL,
    content_md     TEXT NOT NULL DEFAULT '',
    icon           TEXT,
    cover_image    TEXT,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_home        INTEGER NOT NULL DEFAULT 0,
    published      INTEGER NOT NULL DEFAULT 1,
    created_by     TEXT NOT NULL,
    last_edited_by TEXT NOT NULL,
    deleted_at     TIMESTAMP,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
    FOREIGN KEY (parent_page_id) REFERENCES team_pages (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_team_pages_slug_live
    ON team_pages (team_id, slug) WHERE deleted_at IS NULL;

-- A team has exactly one Home page, and it cannot be deleted into having none.
CREATE UNIQUE INDEX idx_team_pages_one_home
    ON team_pages (team_id) WHERE is_home = 1 AND deleted_at IS NULL;

-- The sidebar tree is read a level at a time: children of a parent, in order.
CREATE INDEX idx_team_pages_tree
    ON team_pages (team_id, parent_page_id, sort_order);

-- A snapshot of a page's body, written on each save.
--
-- Separate from `file_versions` because a page is not a file: there is no blob,
-- no storage path and no encryption envelope, and the content is small enough
-- to hold inline. Reusing that table would have meant a version row that points
-- at no storage, which is worse than a second table that means what it says.
--
--   version_number  per page, starting at 1 and never reused, so a version
--                   label in a URL keeps meaning the same snapshot after an
--                   older version is pruned.
--   label           an optional name an editor gives a snapshot, the same way
--                   named file versions work.
CREATE TABLE team_page_versions (
    id             TEXT NOT NULL PRIMARY KEY,
    page_id        TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    title          TEXT NOT NULL,
    content_md     TEXT NOT NULL,
    label          TEXT,
    created_by     TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (page_id) REFERENCES team_pages (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_team_page_versions_number
    ON team_page_versions (page_id, version_number);

-- History is read newest-first, per page.
CREATE INDEX idx_team_page_versions_page
    ON team_page_versions (page_id, created_at);
