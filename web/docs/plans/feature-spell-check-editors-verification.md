# Manual Verification: Spell Check for Docs, Slides, and Sheets Editors

Branch: `feature/spell-check-editors`
Feature flag: `feature.editors.spellCheck` / `NEXT_PUBLIC_FEATURE_SPELL_CHECK`

---

## Prerequisites

- [ ] Dev server running (`pnpm dev` in `neutrino-web/`)
- [ ] Browser spell check is enabled at the OS/browser level (system setting)
- [ ] Open the Docs, Slides, and Sheets editors in separate tabs for parallel testing

---

## Steps to Verify

### Happy Path — Spell Check Active by Default

#### Docs Editor
1. Open any document in the Docs editor.
2. Click into the document body and type a misspelled word (e.g. `helo`).
3. Verify a red underline appears under the misspelled word (browser-provided).

#### Slides Editor — inline text
1. Open any presentation in the Slides editor.
2. Double-click a text element on a slide to enter edit mode.
3. Type a misspelled word (e.g. `helo`).
4. Verify a red underline appears.

#### Slides Editor — speaker notes
1. In the Slides editor, locate the speaker notes area below the canvas.
2. Type a misspelled word (e.g. `helo`).
3. Verify a red underline appears.

#### Sheets Editor — sheet title
1. Open any spreadsheet in the Sheets editor.
2. Click the sheet title area (top-left, next to the back arrow) and type a misspelled word.
3. Verify a red underline appears.

#### Sheets Editor — formula bar
1. Click any cell in the spreadsheet.
2. Click the formula bar input and type a formula such as `=SUM(`.
3. Verify NO red underlines appear (formula inputs intentionally have spell check off).

---

### Keyboard Toggle — Feature Flag ON

> Enable the feature flag first: set `NEXT_PUBLIC_FEATURE_SPELL_CHECK=true` in `.env.local` and restart the dev server.

#### Toggle off
1. Open the Docs editor with some misspelled text visible.
2. Press `Cmd+Shift+;` (macOS) or `Ctrl+Shift+;` (Windows/Linux).
3. Verify the red underlines disappear immediately.

#### Toggle on
1. With spell check toggled off (previous step), press `Cmd+Shift+;` again.
2. Verify the red underlines reappear.

#### Persistence across refresh
1. Toggle spell check off (`Cmd+Shift+;` / `Ctrl+Shift+;`).
2. Refresh the page.
3. Verify red underlines are still absent (off state was persisted).
4. Toggle back on and refresh again.
5. Verify underlines reappear (on state was persisted).

---

### Feature Flag OFF

1. Set `NEXT_PUBLIC_FEATURE_SPELL_CHECK=false` (or remove the env var) and restart the dev server.
2. Open the Docs editor and confirm spell check underlines are visible (default on).
3. Press `Cmd+Shift+;` — verify nothing happens (shortcut not registered).
4. Confirm the user cannot toggle spell check off.

---

### Edge Cases

#### localStorage cleared
1. Open DevTools → Application → Local Storage → clear `neutrino.spellCheck`.
2. Refresh any editor.
3. Verify spell check is active (defaults to true when no stored value).

#### Different editors share the same preference
1. Set spell check to off in the Docs editor (via `Cmd+Shift+;` with flag enabled).
2. Navigate to the Slides editor.
3. Verify spell check is also off in Slides (shared localStorage key).

---

## Expected Results

| Scenario | Expected |
|---|---|
| Default (no localStorage value) | Spell check ON in all editors |
| localStorage `neutrino.spellCheck=false` | Spell check OFF in all editors |
| `Cmd+Shift+;` with flag ON | Toggles between on and off |
| `Cmd+Shift+;` with flag OFF | No effect |
| Formula bar input | Spell check always OFF |
| Page refresh | Preference preserved from localStorage |

---

## Rollback

Disable `NEXT_PUBLIC_FEATURE_SPELL_CHECK` — removes the keyboard shortcut instantly, no deployment needed.

Spell check via the HTML attribute will remain active by default; to fully disable it, set `localStorage.setItem('neutrino.spellCheck', 'false')` in the browser console or revert the code change.
