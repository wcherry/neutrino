# Plan: DB-Backed Feature Flags

## Branch: feature/db-backed-feature-flags

## Summary

Replace the static `featureFlags.ts` env-var file with a DB-backed system. The
backend, the frontend provider, and all callsites have already been built on
prior branches. This branch completes the cleanup.

## What already exists (no new code needed)

- **Migration** `00088_admin__2026-06-01-000000_create_feature_flags` — creates
  the `feature_flags` table and seeds all known flags.
- **Rust backend** `src/drive/feature_flags/` — `model.rs`, `repository.rs`,
  `api.rs`. Exposes:
  - `GET /api/v1/feature-flags` (public, returns `{key: bool}` map)
  - `GET /api/v1/admin/feature-flags` (admin only, returns array with metadata)
  - `PATCH /api/v1/admin/feature-flags/{key}` (admin only)
- **Frontend provider** `web/apps/web/src/providers/FeatureFlagsProvider.tsx`
  — fetches from `/api/v1/feature-flags` on mount, exposes `useFeatureFlags()`
  and `useFeatureFlagsLoaded()`.
- **All callsites** already import from `@/providers/FeatureFlagsProvider`.
- **Tests** already mock `@/providers/FeatureFlagsProvider` (not the old file).
- **api-admin** already has `listFeatureFlags()`, `updateFeatureFlag()`, and
  the `FeatureFlag` / `UpdateFeatureFlagRequest` types.
- **Admin UI** (`/admin` page) has a Feature Flags tab using `listFeatureFlags`.
- **CLAUDE.md** already updated to describe the DB-backed approach.

## What remains (this branch)

1. Move the `FeatureFlags` type from `web/apps/web/src/lib/featureFlags.ts`
   into `FeatureFlagsProvider.tsx` so the static file can be safely deleted.
2. Delete `web/apps/web/src/lib/featureFlags.ts`.
3. Run `pnpm type-check` and `pnpm test` to confirm nothing is broken.

## Acceptance criteria

- `featureFlags.ts` does not exist.
- `FeatureFlagsProvider.tsx` imports no module from `@/lib/featureFlags`.
- `pnpm type-check` passes with zero errors.
- `pnpm test` passes with zero failures.

## No feature flag needed

This change is a pure code cleanup — it removes dead code with no behavioural
change (the provider already fetches from the API). No feature flag is required.
