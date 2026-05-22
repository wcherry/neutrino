# Implementation Plan: Spell Check for Docs, Slides, and Sheets Editors

Branch: `feature/spell-check-editors`
Date: 2026-04-28

---

## What Is Changing and Why

Users have no way to catch spelling mistakes while writing in the three editors.
This feature adds browser-native spell check (via the HTML `spellcheck` attribute)
to every user-facing text-entry area in Docs, Slides, and Sheets, plus a
`Cmd+Shift+;` keyboard shortcut to toggle spell check on or off. The state
persists in `localStorage` so the user's preference survives page refreshes.

---

## Layers Affected

| Layer | Concern |
|---|---|
| Shared hook (new file) | `useSpellCheck` — reads/writes `localStorage`, listens for the keyboard shortcut, returns current boolean state |
| Docs editor | Pass `spellCheck` boolean to `EditorContent` via Tiptap `editorProps.attributes` |
| Slides editor | Pass `spellCheck` to the text-edit `<textarea>` and the speaker-notes `<textarea>` |
| Sheets editor | Pass `spellCheck` to the formula bar `<input>` and the sheet-title `contentEditable` div |
| Feature flag | `feature.editors.spellCheck` — controls whether the keyboard shortcut is registered and whether the toggle UI is surfaced |
| Tests | Unit tests for the `useSpellCheck` hook logic |

---

## Architecture

### Shared hook: `useSpellCheck`

New file: `apps/web/src/hooks/useSpellCheck.ts`

```ts
// Signature
export function useSpellCheck(): { spellCheck: boolean; toggle: () => void }
```

- Initialises from `localStorage.getItem('neutrino.spellCheck')` (default `true`).
- Writes back to `localStorage` on every toggle.
- Registers a `keydown` listener on `document` for `Cmd+Shift+;` (Mac) /
  `Ctrl+Shift+;` (Windows/Linux) — only when the feature flag is enabled.
- Returns the current boolean and a stable `toggle` function.

### Feature flag

Key: `feature.editors.spellCheck`
Env var: `NEXT_PUBLIC_FEATURE_SPELL_CHECK`
Default: `false` (off in all environments until explicitly enabled).

Added to `apps/web/src/lib/featureFlags.ts`.

### Docs editor (`DocEditor.tsx`)

The Tiptap editor already sets `spellcheck: 'true'` hardcoded in `editorProps`.
Change this to read from `useSpellCheck`:

```ts
editorProps: {
  attributes: { class: 'ProseMirror', spellcheck: spellCheck ? 'true' : 'false' },
},
```

Because `useEditor` re-creates the editor only once, we use an effect to update
the DOM attribute on the ProseMirror element directly when `spellCheck` changes,
rather than re-creating the editor.

### Slides editor (`SlideEditor.tsx`)

Two text areas need the attribute:
1. The `<textarea>` used for inline text-element editing (around line 2224).
2. The `<textarea>` used for speaker notes (around line 2003).

### Sheets editor

Two areas:
1. Formula bar `<input>` in `FormulaBar.tsx` — add `spellCheck={spellCheck}` prop.
2. Sheet title `contentEditable` div in `SheetEditor.tsx` — add `spellCheck={spellCheck}`.

`FormulaBar` will receive a new optional `spellCheck?: boolean` prop (defaulting
to `false` — formulas are not natural language).

---

## Keyboard Shortcut

`Cmd+Shift+;` on macOS / `Ctrl+Shift+;` on other platforms.

This shortcut does not conflict with any existing shortcut in the codebase
(existing shortcuts: `Cmd+S`, `Cmd+K`, `Cmd+\`, `Cmd+B`, `Cmd+I`).

The listener is registered inside `useSpellCheck` rather than inside each editor,
so a single registration covers all three.

---

## Feature Flag

Name: `feature.editors.spellCheck`
Env var: `NEXT_PUBLIC_FEATURE_SPELL_CHECK`
Default: `false`

When the flag is **off**:
- The keyboard shortcut is not registered.
- Spell check is still applied via the `spellCheck` attribute (defaulting to `true`
  from localStorage), but the user cannot toggle it via the shortcut.

When the flag is **on**:
- The keyboard shortcut is active.

This allows the feature to be deployed and be immediately useful (spell check on
by default) while the toggle shortcut can be enabled separately when ready.

---

## Known Risks and Edge Cases

1. **Tiptap ProseMirror element**: `EditorContent` renders a `div.ProseMirror`
   that is `contentEditable`. Tiptap reads `editorProps.attributes` only at
   construction time. To update `spellcheck` after construction we must locate the
   element via `editor.view.dom` and set the attribute imperatively in a
   `useEffect`.

2. **Formula bar**: Formulas are not natural language; spell check on formula
   inputs produces noise. The `FormulaBar` input receives `spellCheck={false}`
   as a static default regardless of the user's preference. Only the sheet title
   div (which holds user-supplied text) honours the preference.

3. **SSR**: `localStorage` is not available during server render. The hook must
   guard with `typeof window !== 'undefined'`.

4. **Multiple editor instances on the same page**: The keyboard shortcut fires
   globally. If two editors were open simultaneously only one `useSpellCheck`
   instance should own the listener. In practice each editor page is a separate
   Next.js route so this is not an issue.

---

## Acceptance Criteria

- [ ] Opening the Docs editor shows red underlines for misspelled words (browser-provided).
- [ ] Opening the Slides editor shows red underlines in text-box editing mode and the notes area.
- [ ] Opening the Sheets editor shows red underlines in the sheet title area.
- [ ] Pressing `Cmd+Shift+;` toggles spell check off — underlines disappear immediately.
- [ ] Pressing `Cmd+Shift+;` again toggles spell check back on — underlines reappear.
- [ ] Refreshing the page preserves the last toggle state.
- [ ] The feature can be enabled/disabled via `NEXT_PUBLIC_FEATURE_SPELL_CHECK=true/false`.

---

## Files to Create / Modify

| Action | File |
|---|---|
| Create | `apps/web/src/hooks/useSpellCheck.ts` |
| Modify | `apps/web/src/lib/featureFlags.ts` |
| Modify | `apps/web/src/app/(apps)/docs/editor/DocEditor.tsx` |
| Modify | `apps/web/src/app/(apps)/slides/editor/SlideEditor.tsx` |
| Modify | `apps/web/src/app/(apps)/sheets/editor/SheetEditor.tsx` |
| Modify | `apps/web/src/app/(apps)/sheets/editor/components/FormulaBar.tsx` |
| Create | `apps/web/src/__tests__/useSpellCheck.test.ts` |
