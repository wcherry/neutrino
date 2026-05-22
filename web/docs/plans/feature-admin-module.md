# Plan: Admin Module

## Branch
`feature/admin-module`

## What is changing and why
Adding a frontend admin module to neutrino-web that connects to the admin API endpoints
implemented in neutrino-drive (commit a034ee4). The admin dashboard exposes process
monitoring, disk usage, and service registry management.

## Layers affected

### Auth package
- Add `isAdmin` field to `UserProfile` type
- Add `decodeJwtAdmin()` helper that reads the JWT payload from localStorage and returns
  whether `is_admin` is true — no library needed, JWT payload is base64url JSON

### New: packages/api-admin
- Create a new thin API client package `@neutrino/api-admin` following the same pattern
  as other api-* packages
- Types: `ProcessInfo`, `DiskUsageInfo`, `PathUsage`, `ServiceInfo`
- Client: `adminApi` with `getProcesses()`, `getDisk()`, `listServices()`, `updateService()`
- Endpoints mirror the backend: `/admin/api/processes`, `/admin/api/disk`,
  `/admin/api/services`, `PATCH /admin/api/services/{name}`

### apps/web
- Feature flag: `NEXT_PUBLIC_FEATURE_ADMIN` (default off)
- Route: `apps/web/src/app/(apps)/admin/page.tsx` — tab-based page (Processes, Disk, Services)
- Admin guard: redirects to `/drive` if `!user.isAdmin`
- Navigation: add "Admin" nav item to the layout, visible only when `user.isAdmin` and
  feature flag is enabled
- CSS Module: `page.module.css` following settings page patterns

### apps/web/src/lib/api.ts
- Re-export from `@neutrino/api-admin`

## Feature flag
- Name: `feature.admin.dashboard` (env var: `NEXT_PUBLIC_FEATURE_ADMIN`)
- Default: off in all environments
- Location: `apps/web/src/lib/featureFlags.ts` (new file)

## How isAdmin is derived
The neutrino-drive backend embeds `is_admin: true` in the JWT access token claims.
The `UserProfile` returned by `GET /api/v1/auth/me` does NOT include isAdmin (confirmed
by reading types.ts). We derive admin status by:
1. Reading `localStorage.getItem('access_token')`
2. Base64url-decoding the payload section (index [1] of the dot-split)
3. Returning `claims.is_admin === true`

This is safe because the flag only gates UI access — the backend enforces the `AdminUser`
extractor on all /admin/api/* endpoints regardless.

## Known risks
- JWT parsing must handle malformed tokens gracefully
- If the access token is refreshed, isAdmin remains correct since it re-reads localStorage
- The feature flag guard must be consistent across client renders

## Acceptance criteria
- [ ] `/admin` route redirects non-admin users to `/drive`
- [ ] Processes tab shows PID, name, status, CPU%, memory
- [ ] Disk tab shows used/free/total with a progress bar
- [ ] Services tab shows list with toggle switches
- [ ] Toggle calls PATCH /admin/api/services/{name} and updates UI
- [ ] "Admin" nav link only visible to admins
- [ ] Feature flag `NEXT_PUBLIC_FEATURE_ADMIN=true` enables the module
- [ ] All tests pass
