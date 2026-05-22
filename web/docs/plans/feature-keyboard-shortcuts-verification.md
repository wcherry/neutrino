# Manual Verification: Common Keyboard Shortcuts for Docs and Sheets

## Prerequisites
- [ ] Feature flag `NEXT_PUBLIC_FEATURE_KEYBOARD_SHORTCUTS=true` set in `.env.local`
- [ ] Dev server running (`pnpm dev` in `neutrino-web`)
- [ ] Logged in with any account

---

## Docs — Ctrl+K (Insert / Edit Link)

### Happy path — set a link
1. Open any document (or create a new one)
2. Type some text, e.g. `Visit our site`
3. Select the text with the mouse or Ctrl+A
4. Press **Ctrl+K**
5. **Expected:** a prompt dialog appears pre-filled with `https://`
6. Enter `https://example.com` and confirm
7. **Expected:** the selected text is now a clickable link (underlined, styled as a link in the editor)

### Edit an existing link
1. Click inside the linked text from the step above
2. Press **Ctrl+K**
3. **Expected:** prompt appears pre-filled with `https://example.com`
4. Change the URL and confirm
5. **Expected:** link href updated

### Remove a link
1. Select the linked text
2. Press **Ctrl+K**, clear the field and confirm with an empty string
3. **Expected:** link removed; text remains but is no longer an anchor

### Cancel does nothing
1. Select some text
2. Press **Ctrl+K** and click Cancel (or press Escape)
3. **Expected:** nothing changes

---

## Docs — Ctrl+\ (Clear Formatting)

### Clear bold
1. Select some text, press **Ctrl+B** to bold it — confirm it appears bold
2. Keep the text selected, press **Ctrl+\**
3. **Expected:** bold removed; text returns to normal weight

### Clear italic
1. Select some text, press **Ctrl+I** to italicise — confirm it appears italic
2. Keep selected, press **Ctrl+\**
3. **Expected:** italic removed

### Clear mixed formatting
1. Apply bold + italic to the same selection
2. Press **Ctrl+\**
3. **Expected:** both marks removed in one keystroke

---

## Sheets — Ctrl+B (Bold Cell)

### Toggle bold on
1. Open any spreadsheet (or create a new one)
2. Click on cell **A1**
3. Press **Ctrl+B**
4. **Expected:** the **B** toolbar button becomes highlighted/active; cell content appears bold

### Toggle bold off
1. With A1 still selected (and bold), press **Ctrl+B** again
2. **Expected:** bold removed; toolbar button returns to inactive state

### No effect when formula bar is focused
1. Click on cell A1 (not bold)
2. Click into the formula bar input field
3. Press **Ctrl+B**
4. **Expected:** cell A1 does NOT become bold; toolbar button stays inactive

---

## Sheets — Ctrl+I (Italic Cell)

1. Click on a cell, press **Ctrl+I**
2. **Expected:** cell content appears italic; toolbar **I** button becomes active
3. Press **Ctrl+I** again
4. **Expected:** italic removed; button becomes inactive

---

## Feature Flag OFF

1. Remove `NEXT_PUBLIC_FEATURE_KEYBOARD_SHORTCUTS` from `.env.local` (or set it to any value other than `"true"`) and restart the dev server
2. Try Ctrl+K in Docs — **Expected:** nothing happens (browser default, if any)
3. Try Ctrl+\ in Docs — **Expected:** nothing happens
4. Try Ctrl+B in Sheets — **Expected:** nothing happens (bold toolbar button stays inactive)
5. Try Ctrl+I in Sheets — **Expected:** nothing happens

---

## Rollback

Set `NEXT_PUBLIC_FEATURE_KEYBOARD_SHORTCUTS` to anything other than `"true"` (or remove it entirely) — instant rollback, no deployment required.
