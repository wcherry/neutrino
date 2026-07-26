# Manual Verification: Custom Theme Creation and Editing

## Prerequisites
- [ ] Two test accounts (User A and User B) available for cross-user sharing/ownership checks.
- [ ] Backend running with the `00101_themes__...create_custom_themes` migration applied.
- [ ] Signed in as User A for the "Happy Path" section.

## Steps to Verify

### Happy Path
1. Go to **Settings → Appearance**. Confirm the built-in theme grid (Light, Dark, System, Light Glass, Glass, Midnight, Beach, Forest, Sunbeams) still renders and selecting any of them applies instantly (page chrome recolors immediately, no separate "Save" click needed) and persists (reload the page — the same theme is still selected).
2. Click **Create custom theme**. Confirm the editor modal opens with: a Name field, a light/dark base toggle, Base/Text/Accent/Status tabs each containing labeled color swatches (7/5/4/8 fields respectively), a public/private toggle, and Save/Cancel.
3. Give it a name (e.g. "My Test Theme"), tweak a few colors in different tabs (confirm switching tabs preserves already-edited values), leave it Private, click Save.
4. Confirm: a success toast appears, the modal closes, and a new card for "My Test Theme" appears in the "Custom themes" gallery with a swatch preview matching the colors you picked.
5. Click the new card. Confirm it applies instantly (page recolors to your custom palette) and persists across reload.
6. Go to **Profile** page. Confirm the same "My Test Theme" card appears in the theme gallery there too (shared component — not a second divergent grid), and it's shown as currently selected.
7. Click the Edit (pencil) icon on "My Test Theme". Change a color, save. Confirm the live page recolors to reflect the edit (if it's still the active theme) and the card's swatch preview updates.
8. Click the **Duplicate** (copy) icon on a built-in preset (e.g. Dark). Confirm: a success toast appears, a new custom theme named "Dark copy" appears in the gallery, and the editor modal opens directly on that new copy in edit mode.
9. Click the Duplicate icon on "My Test Theme" itself. Confirm a "My Test Theme copy" appears and is independently editable (editing the copy does not change the original).
10. Toggle "My Test Theme" to Public via the editor. Sign in as User B (or open a private/incognito window and sign in as User B).
11. As User B, go to Settings → Appearance. Confirm "My Test Theme" (User A's public theme) appears in the gallery WITHOUT Edit/Delete icons (not owned by B), but WITH a Duplicate icon.
12. As User B, click Duplicate on "My Test Theme". Confirm it creates a private copy owned by B (editable by B), and does not modify A's original.
13. As User A, delete "My Test Theme" (Trash icon → confirm via the dialog that appears — verify it is a proper dialog component, never a plain browser confirm() popup). If "My Test Theme" was A's currently-active theme, confirm the UI falls back to the System theme cleanly (no stuck/broken `data-theme` state, no blank/unstyled flash beyond the normal reload).

### Edge Cases
1. **Public theme not owned by you**: as User B, confirm you cannot see Edit/Delete affordances on User A's public theme card, and directly hitting `PATCH /api/v1/themes/{id}` or `DELETE /api/v1/themes/{id}` for A's theme (e.g. via browser devtools/curl with B's token) returns 404, not 200/403.
2. **Private theme of another user**: confirm User B's theme gallery never lists any of User A's *private* themes at all (not even read-only).
3. **Invalid token values rejected**: attempt to create a theme with a malformed color (e.g. paste `javascript:alert(1)` into a color field if the UI allows raw text entry, or via direct API call) — confirm the request is rejected with a 400 and the malicious value is never reflected anywhere (no injected `<style>` content, no JS execution).
4. **Deleting the active custom theme**: while a custom theme is your active selection, delete it. Confirm the app falls back to System theme immediately, without requiring a manual reselect or a page reload to recover.
5. **Duplicating Light Glass specifically**: click Duplicate on the "Light Glass" built-in preset. Confirm it succeeds (this exercises the gradient→solid-color substitution fix — `--color-bg` becomes a solid `#ede9fe` in the copy instead of the original gradient) and the resulting custom theme is usable/selectable without error.
6. **No feature flag**: confirm this feature is visible to any signed-in user without needing to toggle anything in the admin feature-flags panel.
7. **Sheets untouched**: open the Sheets app with any theme (built-in or custom) active; confirm spreadsheet cells remain white background / black text regardless of the active theme (never inherit theme colors).
8. **Settings/Profile consistency**: confirm both pages show the identical set of built-in + custom themes, in a visually consistent gallery, and that selecting a theme from either page behaves identically (instant apply + persist, no separate Save button anywhere in the Appearance/theme section).

## Expected Results
- Any theme selection (built-in or custom, from Settings or Profile) applies immediately and survives a page reload.
- Custom theme CRUD (create/edit/delete/duplicate) works only for the owner, except Duplicate, which is available on any visible theme (built-in or public/owned custom).
- No `window.prompt`/`alert`/`confirm` appears anywhere in this flow — deletions use the styled confirmation dialog.
- No new toggle/flag is required in the admin feature-flags panel for any of this to work.
- Sheets cell rendering is visually unaffected by any theme, including custom ones.
