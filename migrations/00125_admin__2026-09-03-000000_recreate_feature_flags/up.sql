-- Recreate the feature flags table that 00124 dropped, for Team Spaces (#185).
--
-- This is a new migration rather than a revert of 00124 or an edit to 00088,
-- because migrations are append-only and 00124's reasoning still stands for the
-- fifteen keys it removed. Those keys do not come back. Every one of them gated
-- a feature that is now unconditional, and re-seeding them would recreate the
-- exact drift 00124 removed: rows nobody consults, describing a product that no
-- longer depends on them.
--
-- What comes back is the mechanism, seeded only with the keys that have a
-- reader on the day this lands. Team Spaces replaces a primary navigation entry
-- across the web client and ships in ten phases, so it needs a switch that does
-- not require a redeploy -- which is the one property an environment variable
-- could not give it.
--
-- The failure mode 00124 documented is designed out rather than re-inherited.
-- Four keys the client's `FeatureFlags` type declared -- docsPresence,
-- docsTrackChanges, docsCompare, docsMobileEditor -- had no row here at all, so
-- they read as `undefined` and were permanently, untoggleably off. Nothing in
-- the schema could have caught that, because the table has no way to know what
-- the client expects to find in it. The check therefore lives in the code that
-- reads the table: `src/drive/feature_flags/catalog.rs` lists every key the
-- product declares, the repository refuses to serve a list that is missing one,
-- and a unit test asserts the catalog and this seed agree. A key added to one
-- and not the other fails the build, not a user's rendering.
--
--   description  carries the flag's owner and the condition under which it is
--                removed. "The flag must be removable in one cleanup PR once
--                the feature is proven stable" is only enforceable if the
--                removal condition is written down where the toggle is.
CREATE TABLE feature_flags (
    key         TEXT PRIMARY KEY NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    updated_at  TEXT NOT NULL
);

-- All four default disabled: with `teamSpaces` off the application is exactly
-- what it was before this migration. The three sub-flags are meaningless on
-- their own -- each is read only after `teamSpaces` has already been checked --
-- so they gate a phase within the feature, not the feature itself.
INSERT INTO feature_flags (key, enabled, description, updated_at) VALUES
    ('teamSpaces',         0,
     'Team Spaces: Team as a top-level object, replacing Shared Drives in the navigation. Owner: drive. Remove once Team Spaces has run enabled in production for a full release cycle with no rollback, in the same PR as the three teamSpaces* sub-flags.',
     datetime('now')),
    ('teamSpacesPages',    0,
     'Team Spaces phase 2-3: the wiki page tree, markdown editing and page version history. Owner: drive. Remove with teamSpaces.',
     datetime('now')),
    ('teamSpacesFiles',    0,
     'Team Spaces phase 4: the team file library -- folders, uploads and versions scoped to a team. Owner: drive. Remove with teamSpaces.',
     datetime('now')),
    ('teamSpacesActivity', 0,
     'Team Spaces phase 8 groundwork: per-team activity logging and its feed. Owner: drive. Remove with teamSpaces.',
     datetime('now'));
