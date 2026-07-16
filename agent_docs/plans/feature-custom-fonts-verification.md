# Manual Verification: Admin-managed Custom Fonts

## Prerequisites
- [ ] A running backend (`cargo run`) with a fresh or migrated SQLite DB (migration `00099_admin__2026-07-12-000000_create_custom_fonts` applied automatically on startup).
- [ ] A running frontend (`pnpm dev` in `web/`).
- [ ] Two accounts: one with `is_admin = true` (to reach `/admin`) and one regular non-admin account.
- [ ] A handful of real font files to upload for testing: at least one `.woff2` (e.g. any Google Fonts static download), and ideally one each of `.woff`/`.ttf`/`.otf` for format coverage. Also have a renamed `.txt`/`.exe` file handy to test rejection, and a file over 50MB to test the size limit.

## Steps to Verify

### Happy Path
1. Sign in as the admin user, navigate to `/admin`, open the new **Fonts** tab.
2. Confirm the tab loads with an empty (or existing) list and no console errors.
3. Use the DropZone to upload a `.woff2` file, enter a display name (e.g. "Test Display Font"), submit.
4. Confirm a success toast appears, the new font shows up in the list with the correct display name, format badge (`woff2`), and an uploaded date.
5. Refresh the page (or open Docs in a new tab) — open a Doc, click the font-family dropdown in the toolbar. Confirm "Test Display Font" appears in the list alongside the built-ins.
6. Select it, type some text, and visually confirm the text renders in the uploaded font (not a fallback).
7. Repeat the same font-family selection + visual render check in:
   - Slides (text box font dropdown)
   - Sheets (cell style font dropdown)
   - Drawing (shape style panel font dropdown)
   - Diagrams (select a shape, check the Properties panel's new font-family dropdown, and the bulk multi-shape font dropdown when 2+ shapes are selected)
8. In `/admin` → Fonts, delete the test font. Confirm it disappears from the admin list immediately.
9. Refresh Docs/Slides/Sheets/Drawing/Diagrams — confirm the deleted font no longer appears in any picker (built-ins remain unaffected).

### Edge Cases
1. **Non-admin access**: sign in as a non-admin user, confirm `/admin` is inaccessible (or the Fonts tab/upload controls are not reachable) and that a direct `PATCH`/`POST`/`DELETE` to `/api/v1/admin/fonts*` without an admin token returns 401/403 (can verify via browser devtools network tab or curl).
2. **Disallowed file type**: attempt to upload a renamed `.txt` or `.exe` file via the admin DropZone. Confirm it's rejected with a clear error toast (not a silent failure or a 500).
3. **Oversized file**: attempt to upload a file over 50MB. Confirm it's rejected with a clear "too large" error rather than hanging or crashing the tab.
4. **Duplicate display names**: upload two fonts with the same display name. Confirm both are accepted and both appear distinctly in every picker (no collision/overwrite).
5. **Unauthenticated session**: sign out fully (clear `access_token` from localStorage) and load any page. Confirm no console errors/redirect loops caused by the custom-fonts fetch (it should simply skip fetching and leave built-in fonts fully functional).
6. **Slow/failed font fetch**: throttle network or block `/api/v1/fonts` in devtools, reload an editor. Confirm the app still loads and built-in fonts still work — custom fonts should fail soft, not block the editor.
7. **Existing built-ins unaffected**: with zero custom fonts uploaded, confirm all five editors' font pickers still show the original hardcoded fonts (Arial, Georgia, Times New Roman, etc.) exactly as before this change.

## Expected Results
- Uploading a font in `/admin` makes it selectable and renders correctly in Docs, Slides, Sheets, Drawing, and Diagrams within one page refresh.
- Deleting a font removes it from the admin list and from every editor's picker after a refresh.
- Invalid uploads (wrong format, over 50MB) are rejected client-visibly, never silently or with a raw 500.
- Non-admin users cannot upload or delete fonts through the API.
- The app remains fully functional (built-in fonts still work) with zero custom fonts, on a fresh/unauthenticated session, or if the fonts endpoint is unreachable.

## Known limitations (by design, not bugs)
- Uploading/deleting a font in `/admin` does not live-push to other already-open tabs/sessions — a refresh is required to see the change, matching existing `FeatureFlagsProvider` behavior for feature flags.
- Diagrams connector labels do not get a font-family control in this PR (only shape text) — connectors have no font UI at all today and introducing one was out of scope.
