# Plan: Remove duplication between Profile and Settings

## Summary

`/profile` and `/settings` grew into two half-overlapping control panels: the theme picker,
the four email-notification checkboxes and the display-name field each exist on both screens,
each with its own copy of the state and its own save button. Issue #60 asks for one rule —
Profile holds **who the user is**, Settings holds **how the app behaves** — and for the
Settings tabs to be split before any one of them gets too crowded. The Account tab is the one
that already is: identity, password, the whole end-to-end-encryption panel and the delete-account
danger zone all live in it.

So: theme and email notifications leave Profile (Settings owns them), display name leaves
Settings (Profile owns it), and the encryption block moves out of Account into a new **Security**
tab. Along the way the surviving display-name field is made to actually save — today neither
copy persists it, because `UpdateProfileRequest` has no `name` and the Settings handler is a
`save.mutate({})` stub with a TODO. Consolidating onto a field that silently does nothing
would make the duplication look resolved without resolving it.

## Affected Repos

- `neutrino` — `web/apps/web/src/app/(apps)/profile/` and `settings/` (the whole change),
  plus `src/auth/` for the `name` field on the profile update endpoint. No iOS or macOS repo
  is touched: the endpoint change is additive (a new optional request field), so every shipped
  client keeps working unchanged.

## Tasks

1. **Backend — accept `name` on `PUT /api/v1/auth/profile`.** Add `name: Option<String>` to
   `UpdateProfileRequest` (`src/auth/dto.rs`) and have `update_extended_profile`
   (`src/auth/service.rs`) write it through the existing `AuthRepository::update_user_name`,
   trimming and rejecting an all-whitespace name. Optional, so an existing client sending no
   `name` is unaffected.
2. **API client — mirror the field.** `name?: string` on `UpdateProfileRequest` in
   `web/packages/auth/src/types.ts`.
3. **Profile page — user info only.** Delete the Appearance section (theme) and the Email
   notifications section along with their state, the `ThemeGrid`/`useTheme` imports and
   `handleThemeSelect`. Send `name` in the save request and call `useAuth().refresh()` on
   success so the topbar and hero pick the new name up.
4. **Settings — new Security tab.** Add `security` to `Tab`/`TABS` and move the Encryption key
   section (status, fingerprint, export/import, `KeyManagementPanel`) and Change password into
   it, out of Account. Account is left with the read-only email, a link across to Profile for
   the rest of the user's details, and the danger zone.
5. **Settings — drop the duplicate display name.** Remove the name field, `handleNameSave`,
   `nameSaved` and the stub TODO from the Account tab.
6. **Re-point the deep links.** `EncryptionWarningMessage` and the import page's
   no-key message say Account; both mean the encryption panel, which is now Security.

## Test Plan

- Unit (Rust): `update_extended_profile` writes a new name onto the user row; omitting `name`
  leaves the existing one alone; a blank/whitespace name is a 400.
- Unit (Vitest): the five `autosaveEncryptionWarning` specs assert the encryption link's href —
  update them to `/settings?tab=security`.
- E2E (`e2e/tests/profile/profile.spec.ts`): Appearance and Email notifications are **gone**
  from Profile; the display name saves and survives a reload.
- E2E (`e2e/tests/settings/settings.spec.ts`): the tab bar lists Security; the Security tab shows
  the encryption panel and Change password; the Account tab no longer offers a display name and
  still has email + delete; `?tab=security` opens directly.

## Open Questions

None.
