# Manual Verification: Profile / Settings deduplication (issue #60)

## Prerequisites
- Stack running locally: `cargo dev` (or the `docker-compose-dev.yml` stack)
- A signed-in account with end-to-end encryption set up

## Steps

### Happy Path — Profile holds the user, Settings holds the app

1. Open http://localhost:9880/profile.
2. Confirm the page shows **only**: the hero (avatar, name, email, bio, website), **About**,
   **Locale**, **Social links**, a short note pointing at Settings, and **Save changes**.
3. Confirm there is **no** theme picker and **no** email-notification checkboxes anywhere on
   the page — both used to be here as well as in Settings.
4. Open http://localhost:9880/settings and confirm the tab bar reads
   **AI Assistant · Appearance · Notifications · Calendar · Account · Security · Advanced**.
5. **Appearance** still shows the theme grid; picking a theme still applies and saves instantly.
6. **Notifications** still shows the four email checkboxes and **Save notifications**.

### Happy Path — the display name actually saves

1. On `/profile`, change **Display name** to something new and click **Save changes**.
2. The button flips to **Saved**, and the name in the hero and in the topbar's user menu
   updates without a reload.
3. Reload the page. The new name is still in the field, still in the hero, still in the topbar.
4. Sign out and back in — the name is still the new one. (Before this change neither the
   Profile nor the Settings copy of this field wrote anything at all.)

### Happy Path — the Security tab

1. Go to **Settings → Security**. Confirm it holds **Change password** and the whole
   **Encryption key** section: status line, key fingerprint, Export key, the key-management
   panel, and Import key from another device.
2. Go to **Settings → Account**. Confirm it holds only the read-only **Email**, an
   **Edit profile** link, and the **Danger zone** — no display-name field, no encryption panel.
3. Click **Edit profile**; it lands on `/profile`.

### Edge Cases

1. **Blank name**: clear the Display name field on `/profile` and save → the save succeeds and
   the account keeps its existing name (a blank name is not sent).
2. **Whitespace name**: type `"  Ada Lovelace  "` and save, then reload → the field reads
   `Ada Lovelace`, trimmed.
3. **Saving the profile does not reset preferences**: pick a non-default theme and turn
   Marketing emails on in Settings, then go to `/profile`, edit the bio and save. Return to
   Settings — the theme and the email preferences are unchanged.
4. **Deep links**: `/settings?tab=security` opens straight on the Security tab. In an editor
   with no encryption key set up, the "Set up encryption" link in the autosave warning now
   lands on Security rather than Account.
5. **Delete account** still works from **Settings → Account → Danger zone**, dialog and all.

## Cleanup
Delete VERIFY.md once the change is proven stable.
