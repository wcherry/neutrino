# Manual Verification: Dedicated /settings Page

## Prerequisites
- [ ] Feature flag `NEXT_PUBLIC_FEATURE_SETTINGS_PAGE=true` set in `.env.local`
- [ ] App running locally (`npm run dev` from `apps/web`)
- [ ] Logged in with a valid account

## Steps to Verify

### Happy Path — AI Assistant tab (default)

1. Click the settings icon in the Topbar
2. Verify navigation goes to `/settings` (not `/profile`)
3. Verify the page loads with 4 tabs: AI Assistant, Appearance, Notifications, Account
4. Verify the AI Assistant tab is active by default
5. Change the provider to "Anthropic Claude"
6. Enter an API key value
7. Click "Save AI settings"
8. Verify the button briefly shows a checkmark and "Saved" label
9. Reload the page and verify the provider and API key are still set (persisted in localStorage under `neutrino.ai.settings`)

### Happy Path — Appearance tab

1. Click the "Appearance" tab
2. Verify the theme segmented button reflects the current saved theme
3. Click "Dark" in the segmented control
4. Click "Save appearance"
5. Verify the button shows "Saved" briefly
6. Navigate away and back to `/settings` > Appearance
7. Verify "Dark" is still selected (loaded from API)

### Happy Path — Notifications tab

1. Click the "Notifications" tab
2. Verify four checkboxes are shown: Critical alerts, General, Product updates, Marketing
3. Verify Critical alerts is checked by default (and Marketing is unchecked)
4. Uncheck "General" and check "Marketing"
5. Click "Save notifications"
6. Navigate away and back to `/settings` > Notifications
7. Verify "General" is unchecked and "Marketing" is checked

### Happy Path — Account tab

1. Click the "Account" tab
2. Verify email field is shown, disabled, and contains the logged-in user's email
3. Verify the display name input is editable
4. Update the display name
5. Click "Save account"
6. Verify the button shows "Saved" briefly
7. Verify the "Change password" section shows a "Coming soon" placeholder (not an editable form)
8. Verify the "Danger zone" section is visible with a "Delete account" button styled in red

### Edge Case — Delete account confirmation dialog

1. On the Account tab, click "Delete account"
2. Verify a modal dialog appears with title "Delete your account?"
3. Verify the dialog has "Cancel" and "Delete account" buttons
4. Click "Cancel" — verify the dialog closes without any action
5. Click "Delete account" again, then click "Delete account" in the dialog
6. Verify the dialog closes (the action is a stub — no actual deletion should occur)

### Feature Flag Off

1. Remove `NEXT_PUBLIC_FEATURE_SETTINGS_PAGE=true` from `.env.local` (or set to `false`)
2. Restart the dev server
3. Click the settings icon in the Topbar
4. Verify navigation goes to `/profile` (not `/settings`)
5. Navigate directly to `/settings` in the browser
6. Verify it redirects to `/profile`
7. Re-enable the flag when done

## Expected Results

- Settings icon in Topbar navigates to `/settings` when flag is on
- Four tabs render correctly
- AI settings persist in localStorage
- Appearance and notification saves POST to `/api/v1/auth/profile`
- Account email field is read-only
- Change password section shows "Coming soon" placeholder
- Delete account button shows confirmation dialog before any action
- Feature flag off: Topbar navigates to `/profile`; direct `/settings` URL redirects to `/profile`

## Rollback

Disable `NEXT_PUBLIC_FEATURE_SETTINGS_PAGE` — instant rollback, no deployment required.
The profile page is untouched and retains all its existing functionality.
