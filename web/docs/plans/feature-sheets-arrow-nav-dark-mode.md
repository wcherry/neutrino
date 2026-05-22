# Plan: Sheets Arrow Key Navigation + Dark Mode Contrast Fixes

## Branch
`feature/sheets-arrow-nav-dark-mode`

## What is changing and why

### Feature 1 — Arrow key cell navigation
When a cell is selected but NOT being edited, pressing ArrowUp/Down/Left/Right moves the selection one cell in that direction. This is standard spreadsheet UX and is currently missing.

### Feature 2 — Dark mode contrast fixes
a. **Sheet tabs**: The tab bar background is `rgb(240,240,245)` (hardcoded light colour). In dark mode this stays light while the rest of the app goes dark — active/inactive tabs are hard to distinguish and clash with the dark palette.

b. **Selected cell**: `.cellSelected` applies `background-color: rgba(66, 133, 244, 0.15)` on top of the cell's hardcoded `background-color: #ffffff`. In dark mode the overlay is too dark and makes text hard to read. The selection should use a visible border/outline rather than a fill that competes with the forced white cell background.

## Layers affected
- **Frontend only** — no backend changes
- `apps/web/src/app/(apps)/sheets/editor/SheetEditor.tsx` — keyboard handler (Feature 1)
- `apps/web/src/app/(apps)/sheets/editor/page.module.css` — selection overlay & tab bar dark mode (Feature 2)
- `apps/web/src/app/(apps)/sheets/editor/SheetGrid.tsx` — scroll-into-view after arrow navigation (Feature 1)
- `apps/web/src/app/(apps)/sheets/editor/components/SheetTabBar.tsx` — no code change needed, CSS only

## Architecture decisions

### Feature 1 — Where to put the keyboard handler
`SheetEditor.tsx` already has a `document.addEventListener('keydown', handler)` effect (for Ctrl+B/I and Ctrl+S). Arrow key navigation will be added as another document-level `keydown` handler in the same file.

**Guard conditions (do NOT move when):**
1. `document.activeElement` is the formula bar input (`editing.formulaInputRef.current`) — user is typing in the formula
2. `document.activeElement` is a `contentEditable` element (title input)
3. `document.activeElement` is an input/textarea anywhere in the editor
4. A modifier key is held (`e.ctrlKey || e.metaKey || e.altKey`)
5. No cell is currently selected (`selectionAnchor` is undefined)

**Clamping:** use `alphaToNum`/`numToAlpha` from utils and `MAX_ROWS`/`MAX_COLS` from constants to clamp at boundaries.

**Scroll-into-view:** After updating the selection, call `scrollIntoView` on the newly selected cell's DOM element. The cell elements are rendered as `<div id={cellId} ...>` inside the scrollable `bodyRef` div in `SheetGrid`. The handler in `SheetEditor` needs access to the scroll container. We will expose `bodyRef` from `SheetGrid` via a forwarded ref or a callback ref prop — simplest is adding an optional `scrollBodyRef` prop to `SheetGrid` that is wired to `bodyRef`.

**Edit detection:** The formula bar input ref (`editing.formulaInputRef`) is already available in `SheetEditor`. We check `document.activeElement === editing.formulaInputRef.current` to detect editing mode.

### Feature 2 — CSS-only dark mode fixes

**Tab bar:**
- `.sheetTabBar` background is `rgb(240, 240, 245)` — add a `[data-theme="dark"] .sheetTabBar` override in the CSS module. Since CSS modules don't support attribute selectors on ancestor elements natively in the same way, we need a `:global` block.
- Dark palette from `colors.css`: `--color-surface` = `#1e293b`, `--color-surface-raised` = `#334155`, `--color-border` = `#334155`.
- Inactive tab dark: background `#1e293b` (surface), text `var(--color-text)`.
- Active tab dark: background `#334155` (surface-raised), blue top border already uses `var(--color-accent)` which is already dark-mode-aware. 
- Hover dark: slightly lighter, `#263447`.

**Selected cell highlight:**
- The cell `background-color: #ffffff` is intentionally hardcoded and must NOT change (project memory constraint).
- `.cellSelected` currently adds `background-color: rgba(66, 133, 244, 0.15)` — this blends with `#ffffff` in light mode to a pale blue. In dark mode the cell background is still `#ffffff` so the overlay works, but the selection border (rendered as an absolutely positioned overlay div in `SheetGrid` with `border: 2px solid #1a73e8`) is the primary visual. The issue description says the selected cell has a "dark background" — this is likely the `cellSelected` class applying the tinted background which over the white cell in dark mode looks odd when the surrounding UI is dark.
- Fix: keep `.cellSelected` for the blue tint but also ensure the selection overlay border is more visible in dark mode. For dark mode, override `.cellSelected` to use a stronger/more saturated blue tint. Also the selection overlay div (`border: 2px solid #1a73e8`) is inline-styled in SheetGrid, so we either:
  - Keep it but ensure dark mode overlay is more visible.
  - The overlay div sits on `position: absolute` in the `bodyRef` container, so no CSS module class applies to it. The cell itself uses `.cellSelected`.
- Simplest fix: in dark mode override `.cellSelected` to use a brighter blue with a stronger outline. The selection is shown via TWO mechanisms: (a) the `cellSelected` CSS class on each cell and (b) the absolute-positioned overlay `div` with inline border style. In dark mode `#ffffff` cell background + `rgba(66,133,244,0.15)` overlay is visible, but since the overlay `div` uses inline style we can change the overlay color by making it theme-aware via a CSS custom property.
- Plan: Change the inline `border: '2px solid #1a73e8'` in `SheetGrid.tsx` to use `border: '2px solid var(--color-accent)'` — since `--color-accent` is `#3b82f6` in dark mode (brighter blue), this will be more visible. Also update `.cellSelected` to use `var(--color-accent)` at 20% opacity so the fill is theme-appropriate.

## Specialist agents needed
- `frontend-developer` — Feature 1 keyboard handler + scroll-into-view + SheetGrid bodyRef exposure
- `ui-designer` — Feature 2 dark mode CSS

## Tests
- Unit tests for the arrow navigation logic (clamping, guard conditions) in `apps/web/src/__tests__/sheets/arrowNavigation.test.ts`
- These will be pure logic tests (no DOM required) testing the coordinate computation functions.

## Acceptance criteria
1. Pressing ArrowUp/Down/Left/Right when a cell is selected (not editing) moves selection one cell.
2. Pressing arrows while typing in the formula bar has no effect on cell selection.
3. Navigation clamps at row 1, column A, row MAX_ROWS, column MAX_COLS.
4. Ctrl/Cmd/Alt+Arrow does not trigger navigation.
5. In dark mode, active tab is clearly distinguishable from inactive tabs.
6. In dark mode, the selected cell has a clearly visible blue border/highlight without making text unreadable.
7. Cell fill colors set by the user are not affected by dark mode.

## Feature flag
Not required — both changes are pure polish with no behavioural risk. No flag needed.
