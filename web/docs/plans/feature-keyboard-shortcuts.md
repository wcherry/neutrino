# Plan: Common Keyboard Shortcuts for Docs and Sheets

## What and Why

Several keyboard shortcuts are listed in the UI (help modal, menu tooltips) but not wired to actual key events. Users pressing them get no response. This change wires up the missing shortcuts so the UI is consistent with what it promises.

### Docs — missing shortcuts
| Shortcut | Action | Current state |
|---|---|---|
| Ctrl+K | Insert / edit link | Listed in Format menu and help modal; not wired |
| Ctrl+\ | Clear all formatting | Listed in Format menu and help modal; not wired |

TipTap already handles Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Z, Ctrl+Y natively via its extensions — no changes needed there.

### Sheets — missing shortcuts
| Shortcut | Action | Current state |
|---|---|---|
| Ctrl+B | Toggle bold on selected cell(s) | Toolbar button exists; no keyboard handler |
| Ctrl+I | Toggle italic on selected cell(s) | Toolbar button exists; no keyboard handler |

`CellStyle.textDecoration` only supports `'line-through'` (no underline type), so Ctrl+U is out of scope for sheets.

## Layers Affected

- **Frontend only** — no backend or Rust changes required
- Files to change:
  - `apps/web/src/app/(apps)/docs/editor/DocEditor.tsx` — expand Ctrl+S handler to cover Ctrl+K and Ctrl+\
  - `apps/web/src/app/(apps)/sheets/editor/SheetEditor.tsx` — add formatting shortcut handler
  - `apps/web/src/app/(apps)/sheets/editor/StyleToolbar.tsx` — update button titles to show shortcuts

## Specialist Agents

| Agent | Task |
|---|---|
| `test-writer` | Write E2E Playwright specs that exercise each shortcut and confirm the expected DOM/style change |
| `frontend-developer` | Implement the keyboard handlers |

`test-writer` runs first (TDD red phase); `frontend-developer` implements against the failing tests.

## Feature Flag

Flag name: `NEXT_PUBLIC_FEATURE_KEYBOARD_SHORTCUTS`  
Utility: `src/lib/featureFlags.ts` → `featureFlags.keyboardShortcuts`  
Default: **off** (env var absent or not `"true"`)  
Enable: set `NEXT_PUBLIC_FEATURE_KEYBOARD_SHORTCUTS=true` in `.env.local`  
Guard location: the new keyboard event handlers in `DocEditor.tsx` and `SheetEditor.tsx`

## Risks and Edge Cases

- Handlers must be skipped when a text `<input>`, `<textarea>`, or `contentEditable` element is focused (e.g. the formula bar in sheets, the title input) — otherwise Ctrl+B while typing would break normal text entry.
- Ctrl+K in docs opens `window.prompt`; if the user cancels, nothing should change.
- Clearing an empty/no link with Ctrl+K (empty string) should remove the link mark rather than set an empty href.
- Ctrl+\ should not crash when the cursor is in a table cell or other complex node.

## Acceptance Criteria

- [ ] Pressing Ctrl+B with a cell selected in Sheets toggles `fontWeight: bold` on that cell
- [ ] Pressing Ctrl+I with a cell selected in Sheets toggles `fontStyle: italic` on that cell
- [ ] Pressing Ctrl+B / Ctrl+I while typing in the Sheets formula bar has no effect on cell style
- [ ] Pressing Ctrl+K in Docs opens a link prompt and sets the link on the selected text
- [ ] Pressing Ctrl+\ in Docs removes all marks and nodes from the selected text
- [ ] All of the above work with the feature flag enabled; with the flag disabled the old no-op behaviour is preserved
- [ ] E2E tests pass for all shortcuts
