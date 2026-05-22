# Plan: Dedicated /settings Page

## Branch
`feature/settings-page`

## What is changing and why

A new `/settings` page is being added to the Neutrino web app. Currently, AI settings, appearance (theme), and email notification preferences are buried inside `/profile`. A dedicated settings page improves discoverability and separation of concerns — the profile page stays focused on identity/bio/social, while settings handles configuration.

The `Topbar` currently has a placeholder `onSettings={() => console.log('settings')}`. This will be wired to navigate to `/settings`.

## Layers affected

- **Frontend (TSX)**: New `(apps)/settings/page.tsx` with tabbed layout — 4 tabs
- **Styles (CSS Modules)**: New `(apps)/settings/page.module.css` for tab bar and page chrome; reuses profile class names where possible
- **Layout wiring**: `(apps)/layout.tsx` — change `onSettings` stub to `router.push('/settings')`

## Files to create/change

| File | Action |
|---|---|
| `apps/web/src/app/(apps)/settings/page.tsx` | Create |
| `apps/web/src/app/(apps)/settings/page.module.css` | Create |
| `apps/web/src/app/(apps)/layout.tsx` | Edit — wire `onSettings` |

## Tabs and content

### Tab 1: AI Assistant (default)
- Provider select (Gemini / Claude / OpenAI)
- API key input (password type)
- Save button with "Saved" confirmation feedback
- Uses existing `useAiSettings` hook

### Tab 2: Appearance
- Theme segmented button: Light / Dark / System
- Saves via `authApi.updateProfileDetails({ theme })` mutation
- Reads initial value from `useQuery(['profile-details'])`

### Tab 3: Notifications
- Four email checkboxes: Critical alerts, General, Product updates, Marketing
- Saves via `authApi.updateProfileDetails({ emailPreferences: { ... } })` mutation

### Tab 4: Account
- Display current email (read-only)
- Editable display name — saves via `updateProfileDetails`
- Change password section: current password + new password + confirm
  - No `/api/v1/auth/change-password` route exists in the auth package — stub with a TODO comment and show a "Coming soon" note
- Danger zone: Delete account button with confirmation dialog — stub handler with TODO

## Feature flag

- Flag name: `feature.settings.dedicated-page`
- Env var: `NEXT_PUBLIC_FEATURE_SETTINGS_PAGE`
- Default: **off** in all environments
- Gate: the `onSettings` navigation in `layout.tsx` is unconditional (always navigates to `/settings`), but the flag guards the page rendering itself; when off, the page redirects back to `/profile`

## Risks and edge cases

- Profile data may be loading when the page first mounts — show loading spinner
- Theme / email prefs are already on the profile page; both pages write to the same backend field — the last-writer wins, which is fine since users only ever edit one page at a time
- No change-password endpoint exists — stub it clearly so it's easy to wire up later
- The `(apps)` route group automatically provides sidebar/topbar layout — no extra wrapping needed

## Acceptance criteria

- Navigating to `/settings` shows the tabbed layout with 4 tabs
- AI tab saves to localStorage via `useAiSettings`
- Appearance tab loads current theme from API and saves on click
- Notifications tab loads checkboxes from API and saves on button click
- Account tab shows email (read-only) and name (editable); password form shows "Coming soon" placeholder; delete button shows a confirm dialog before any action
- Topbar settings icon navigates to `/settings` instead of console.log
- Feature flag `NEXT_PUBLIC_FEATURE_SETTINGS_PAGE=true` enables the navigation; when `false`, the settings page redirects to `/profile`
