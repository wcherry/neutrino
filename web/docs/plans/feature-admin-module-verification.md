# Manual Verification: Admin Module

## Prerequisites
- Feature flag `NEXT_PUBLIC_FEATURE_ADMIN=true` set in `.env.local`
- neutrino-drive running with the admin API (commit a034ee4)
- A user account that has been granted admin status (JWT `is_admin: true`)

## Steps to Verify

### Happy Path — Admin user

1. Sign in with an admin account
2. Verify an "Admin" nav link appears in the sidebar under "Administration"
3. Click "Admin" — confirm the `/admin` route loads the Admin page
4. Confirm three tabs are visible: Processes, Disk Space, Services

#### Processes tab
5. Processes tab is active by default
6. Verify a table appears with columns: PID, Name, Status, CPU%, Memory (RSS KB), Open Files
7. Verify at least one process is listed (the neutrino-drive process)
8. Wait 30 seconds and verify the table auto-refreshes

#### Disk Space tab
9. Click "Disk Space"
10. Verify three stats cards show: Total, Used, Free with human-readable byte values
11. Verify a progress bar shows usage percentage
12. If paths are configured, a paths table should appear below

#### Services tab
13. Click "Services"
14. If services are registered: verify each row shows name, endpoint, version
15. Toggle the enabled switch on a service — verify it changes state
16. Verify the toggle calls the backend and the change persists on refresh

### Edge Cases

#### Non-admin user
1. Sign in with a non-admin account
2. Verify the "Admin" nav link is NOT visible
3. Navigate manually to `/admin`
4. Verify you are immediately redirected to `/drive`

#### Feature flag off
1. Remove `NEXT_PUBLIC_FEATURE_ADMIN=true` from `.env.local`
2. Rebuild/restart the dev server
3. Sign in with an admin account
4. Verify the "Admin" nav link is NOT visible even for admins
5. Navigate manually to `/admin` — verify redirect to `/drive`

#### Network error
1. Stop the neutrino-drive backend
2. Navigate to `/admin`
3. Click through tabs
4. Verify each tab shows an error message instead of crashing

### Feature Flag Off
1. Set `NEXT_PUBLIC_FEATURE_ADMIN=false` (or remove the env var)
2. Restart dev server
3. Verify the Admin nav link is hidden for all users
4. Verify `/admin` redirects to `/drive` for all users

## Expected Results
- Admin nav link only appears for users with `is_admin: true` in their JWT AND when flag is on
- `/admin` redirects unauthorized users to `/drive`
- Processes table shows at minimum the neutrino-drive process
- Disk stats reflect the server's actual storage
- Service toggle persists enabled/disabled state via PATCH /admin/api/services/{name}

## Rollback
Set `NEXT_PUBLIC_FEATURE_ADMIN=false` — instant rollback, no deployment required.
All admin routes remain inaccessible until the flag is re-enabled.
