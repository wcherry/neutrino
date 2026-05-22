# Manual Verification: Light/Dark Mode Theme Switching

## Prerequisites
- App running locally (`pnpm dev` in `apps/web`)
- A logged-in user account with access to the Profile page

## Steps to Verify

### Happy Path — Light theme

1. Open the app in a browser with no existing `neutrino.theme` localStorage key (or clear localStorage).
2. Navigate to **Profile** (`/profile`).
3. In the **Appearance** section, click **Light**.
4. Verify the UI switches to the light colour scheme immediately (white backgrounds, dark text).
5. Open DevTools → Application → Local Storage and confirm `neutrino.theme = "light"`.
6. Hard-reload the page.
7. Verify the app loads in light mode with no visible flash of the wrong theme.

### Happy Path — Dark theme

1. On the Profile page, click **Dark**.
2. Verify the UI switches to the dark colour scheme immediately (dark backgrounds, light text).
3. Confirm `neutrino.theme = "dark"` in localStorage.
4. Hard-reload the page.
5. Verify the app loads in dark mode with no visible flash.

### System theme — follows OS preference

1. On the Profile page, click **System**.
2. Open OS system preferences and set the appearance to **Dark**.
3. Verify the app switches to dark mode without a page reload.
4. Switch OS appearance back to **Light**.
5. Verify the app switches to light mode without a page reload.
6. Confirm `neutrino.theme = "system"` in localStorage.
7. Hard-reload the page.
8. Verify the app loads in the correct mode matching the current OS preference with no flash.

### Profile save button still works

1. On the Profile page, change the **Bio** field to some new text.
2. Click **Save changes**.
3. Verify the button shows a spinner then "Saved" feedback.
4. Reload and confirm the bio was persisted.
5. Verify the currently selected theme is still active after saving (it was not reset by the form save).

### Theme syncs to server silently

1. Set theme to **Dark** on the Profile page.
2. Open DevTools → Network.
3. Verify a PATCH/PUT request is sent to the profile API containing `"theme": "dark"` without clicking any save button.

### data-theme attribute

1. Open DevTools → Elements.
2. Inspect the `<html>` element.
3. Confirm it has `data-theme="light"` (or `"dark"`) set correctly for the current theme.

## Expected Results

| Action | Expected |
|---|---|
| Click Light | UI immediately switches to light palette; `data-theme="light"` on `<html>` |
| Click Dark | UI immediately switches to dark palette; `data-theme="dark"` on `<html>` |
| Click System | UI matches OS preference; updates live when OS changes |
| Hard reload | Correct theme applied before first paint — no flash |
| Profile form save | Saves bio/social/locale fields; does not interfere with theme |

## Rollback

No feature flag is used. To revert, simply deploy the previous commit. The `[data-theme="dark"]` CSS has always been in the bundle; removing the JS that sets the attribute returns the app to always-light mode.
