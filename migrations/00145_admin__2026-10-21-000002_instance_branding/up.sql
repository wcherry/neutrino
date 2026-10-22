-- Instance branding (agent_docs/ui-customization-roadmap.md §6.1).
--
-- What a self-hoster calls their instance: a name, a brand accent, a message on the sign-in page,
-- and three images (a logo for light and for dark backgrounds, and a favicon). The Rust server
-- writes the brand into every HTML page it serves (src/branding/inject.rs), so it is present at
-- first paint with no extra request and no flash of the default brand.
--
-- `instance_branding` has at most one row (id = 1). `version` changes on every write to it or to
-- an asset; it cache-busts the asset URLs and keys the HTML's ETag.
--
-- Images are stored here rather than as Drive files: they are served to signed-out visitors on
-- the sign-in page, and nothing about them is private. Only PNG, WebP and ICO are accepted
-- (checked by magic bytes, at most 256 KiB) — never SVG, which is a document that can run script
-- if it is opened directly on this origin.
--
-- Purely additive.
CREATE TABLE instance_branding (
    id              INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    name            TEXT,
    accent          TEXT,
    sign_in_message TEXT,
    version         TEXT NOT NULL,
    updated_by      TEXT,
    updated_at      TEXT NOT NULL,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE instance_branding_assets (
    kind       TEXT PRIMARY KEY NOT NULL CHECK (kind IN ('logo-light', 'logo-dark', 'favicon')),
    mime_type  TEXT NOT NULL,
    bytes      BLOB NOT NULL,
    updated_at TEXT NOT NULL
);
