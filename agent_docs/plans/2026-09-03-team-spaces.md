# Plan: Team Spaces (issue #185)

## Summary

Two changes that only make sense together. First, bring back a deliberately smaller feature flag
system than the one #183 removed — one where a key the client declares but the table never holds is
an error rather than a silently-off feature, which is the failure mode that made the old system a
second, invisible definition of the product. Second, build Team Spaces on top of it: `Team` as a new
top-level object that owns its members, its wiki pages, its files and folders, its activity and its
own storage quota, replacing `Shared Drives` in the navigation with `Shared Spaces` when the flag is
on and leaving the app untouched when it is off.

The issue lists ten phases. This change delivers the MVP the issue itself names — Part 1 in full,
plus Phases 1, 2, 3, 4 and 6 — and leaves Phases 5 and 7–10 to land behind their own flags
afterwards. See "Deliberately not in this change" at the end.

## Affected Repos

- `neutrino` — all of it. Migrations, the `feature_flags` and `teams` backend modules, the web
  client's provider, admin tab, Shared Spaces UI, and the e2e specs.

No other repo changes. The new routes are additive under `/api/v1/drive/teams`, no existing Drive
response shape moves, and no key-vault envelope changes shape — team pages and team files reuse the
per-file encryption already in place, so the three E2EE implementations stay in agreement and the
six iOS apps plus the macOS client are unaffected by this release. When a later phase gives a team
its own key, that is a coordinated multi-repo change and gets its own issue.

## Tasks

### Part 1 — feature flags

1. `migrations/00125_admin__2026-09-03-000000_recreate_feature_flags` — recreate the table and seed
   only the four `teamSpaces*` keys. The fifteen keys #183 collapsed do not come back; their
   features are unconditional now and re-seeding them would recreate exactly the drift that was
   removed. Every row's description carries an owner and the condition under which the flag is
   removed.
2. `src/schema.rs` — re-add the `feature_flags` table and put it back in `allow_tables_to_appear_in_same_query!`.
3. `src/drive/feature_flags/catalog.rs` — new. `DECLARED_FLAGS`, the server's list of every key the
   product knows about, each with its owner and removal condition. This is what makes a
   declared-but-unseeded key loud: the repository reconciles the table against it.
4. `src/drive/feature_flags/{mod,model,repository,api}.rs` — restored from `3b2f766^`, with
   `list()` returning a `MissingFlagRows` error when a declared key has no row, and a unit test
   asserting the catalog and the migration seed agree.
5. `src/main.rs` — wire the state, the public route, the admin routes and the OpenAPI doc back in.
6. `web/apps/web/src/lib/featureFlags.ts` — new. `FLAG_KEYS` as the single `as const` list the
   `FeatureFlags` type is derived from, so the type cannot declare a key that isn't in the list.
7. `web/apps/web/src/providers/FeatureFlagsProvider.tsx` — restored, plus validation: a response
   missing a declared key throws in development and logs an error in production, rather than
   leaving the key `undefined`.
8. `web/packages/api-admin` — `FeatureFlag`, `UpdateFeatureFlagRequest`, `listFeatureFlags`,
   `updateFeatureFlag` restored.
9. `web/apps/web/src/app/(apps)/admin/page.tsx` — the Feature Flags tab restored.

### Part 2 — Team Spaces

10. `migrations/00126_drive__2026-09-03-000001_create_teams` — `teams` and `team_members`.
11. `migrations/00127_drive__2026-09-03-000002_create_team_pages` — `team_pages` and
    `team_page_versions`.
12. `migrations/00128_drive__2026-09-03-000003_add_team_id_to_files_and_folders` — nullable
    `team_id` on `files` and `folders`, so a team's file library is the same rows, the same storage
    and the same version history as My Drive rather than a parallel copy.
13. `src/schema.rs` — the three new tables and the two new columns.
14. `src/drive/teams/roles.rs` — the six roles and the per-action permission matrix (Phase 6).
15. `src/drive/teams/model.rs` — Diesel records and insertables.
16. `src/drive/teams/repository.rs` — teams, members, and the team-scoped file and folder queries.
17. `src/drive/teams/pages_repository.rs` — pages and page versions.
18. `src/drive/teams/service.rs` — team CRUD, membership, the Home page a new team is created with,
    quota accounting and activity logging.
19. `src/drive/teams/pages_service.rs` — page CRUD, the tree, move/duplicate, soft delete, version
    history, search.
20. `src/drive/teams/dto.rs`, `api.rs` — the routes, each behind `teamSpaces` and its phase flag.
21. `src/main.rs` — wiring and OpenAPI.
22. `web/packages/api-teams` — new client package.
23. `web/apps/web/src/app/(apps)/teams/` — Shared Spaces list, create/rename/archive/delete, the
    team shell with Home / Pages / Files / Members / Settings.
24. `web/apps/web/src/app/(apps)/navSections.ts` — `Shared Spaces` in place of `Shared Drives` when
    `teamSpaces` is on, unchanged when it is off.

## Test Plan

- **Unit (Rust):** `feature_flags` — the public map, admin auth, toggling, unknown key 404, and
  catalog/seed parity. `teams` — the role matrix for every role and action; create seeds a Home
  page and an Owner membership; a non-member gets 404 rather than 403 (a team's existence is not
  public); rename and archive require the right role; page hierarchy rejects a cycle; a page save
  writes a version; team file listing is scoped to the team.
- **Unit (web):** `FLAG_KEYS`/type parity, and the provider's loud failure on a missing key.
- **E2E:** `e2e/tests/teams/team-spaces.spec.ts` and `e2e/tests/settings/feature-flags.spec.ts`
  cover the flag-**off** half and the public flag surface: the nav still shows Shared Drives, the
  Shared Drives page and endpoint still work, all six team routes answer 404 rather than 403, and
  `/api/v1/feature-flags` carries every key the web client declares — the assertion that would have
  caught #183's four phantom keys.

  **The flag-on browser flows are not covered there, and that is a real gap.** Turning a flag on
  needs an admin; the suite registers ordinary users and there is no bootstrap endpoint. The first
  attempt at this promoted a user by running `sqlite3` against the test stack's database from the
  host — which corrupts it, because that file is a Docker bind mount and SQLite's advisory locks do
  not carry across one. The server started answering `database disk image is malformed` and every
  test after that point failed. The fixture was removed, the hazard is written up in
  `e2e/README.md`, and team creation, the Home page, the page tree, versions, the file library and
  the whole role matrix are covered instead by `src/drive/teams/tests.rs` — 55 tests running the
  real migrations against a real database, driving the same service the handlers call — with
  `VERIFY.md` carrying the browser half by hand.

  Closing the gap properly needs a supported admin bootstrap the test compose file opts into. That
  is a privilege surface added to the product for the tests' benefit, so it is called out here as a
  decision rather than made silently; it is not in this change.

## Feature Flag

`teamSpaces` — default `false`. Gates every team route and the navigation change. Sub-flags, each
default `false` and each meaningless with `teamSpaces` off: `teamSpacesPages` (Phases 2–3),
`teamSpacesFiles` (Phase 4), `teamSpacesActivity` (Phase 8 groundwork).

These are database-backed rather than the environment variables `developer_workflow.md` Step 4
describes, because the property the issue wants is toggling without a redeploy. Removal condition,
recorded in each row's description: all four come out in one cleanup PR once Team Spaces has run
enabled in production for a full release cycle with no rollback.

## Deliberately not in this change

Phases 5 (tree navigation, Favorites, Pinned), 7 (team-scoped search over files and app documents —
page search ships here, file search does not), 8 (the activity feed UI; the logging it reads is
written here), 9 (the dashboard widgets replacing a blank Home) and 10 (Sheets/Slides/Diagrams
landing in team Files, Notes in team Pages). Each is independently shippable behind its own flag
and none of them changes the schema this lays down.

## Open Questions

None blocking. One judgment call worth flagging in review: a team's file library reuses `files` and
`folders` with a nullable `team_id` rather than getting its own tables. It means team files inherit
uploads, versions, trash and encryption for free, at the cost of every existing query on those
tables now needing to say which scope it means. The alternative — parallel tables — was rejected
because it duplicates the four subsystems the success criteria explicitly say not to duplicate.
