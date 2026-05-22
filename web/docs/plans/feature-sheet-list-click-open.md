# Plan: Sheet List Click-to-Open Document

## Branch
`feature/sheet-list-click-open`

## What is changing and why

Clicking an item in any document listing page (Sheets, Docs, Notes, Slides) should open the
document. Mouse clicks already work — the `FileGrid` `onItemClick` prop is wired and the sheet
listing page already handles it. However, keyboard users who tab to a card and press Enter or
Space cannot activate the item; the `Card` `<div>` and the list-row `<div>` accept focus but
have no `onKeyDown` handler. This creates an accessibility gap where documents are unreachable
via keyboard.

Additionally, the `Card` component itself does not forward keyboard activation to its `onClick`
handler — it is a plain `<div>` with `tabIndex`. Standard accessibility expectations for
interactive elements require that Enter (and optionally Space) trigger the same action as a click.

## Layers affected

- **Frontend only** — `FileGrid.tsx` (add keyboard handler to card items and list rows)
- **No backend changes** — pure UI fix
- **No design changes** — no visual change; existing CSS already covers `:focus-visible` states
- **Tests** — add keyboard activation tests to the FileGrid test suite

## Specialist agents needed

- `frontend-developer` — add `onKeyDown` handlers to card and list-row elements in FileGrid
- `test-writer` — add unit tests verifying keyboard activation on all three view modes

## Feature flag

No feature flag needed — this is a keyboard accessibility fix, not a behaviour-gating feature.
The fix is always-on and aligns with existing WCAG 2.1 AA requirements.

## Implementation details

In `FileGrid.tsx`, add a shared keyboard handler:

```ts
function handleKeyActivate(
  e: React.KeyboardEvent,
  callback: () => void
) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    callback();
  }
}
```

Apply `onKeyDown` to:
1. `<Card>` elements in the large-grid view (forward to `onItemClick(item)`)
2. `<Card>` elements in the small-grid view (forward to `onItemClick(item)`)
3. `<div className={styles['list-row']}>` elements in the detailed-list view

## Known risks and edge cases

- Pressing Space on the star-badge button or three-dot menu button inside a card must not also
  trigger the card's keyboard handler. The star-badge and menu buttons are `<button>` elements;
  they will receive focus themselves and stop event propagation naturally. No extra handling needed
  because the card's `onKeyDown` fires only when the card itself is the event target (or we use
  `e.currentTarget === e.target` check).
  Actually: Space/Enter on child buttons fire on the button, not the parent div, so no conflict.
- `e.preventDefault()` on Space prevents the page from scrolling, which is correct for an
  activated widget.

## Acceptance criteria

1. Clicking a sheet card (any view mode) navigates to the editor or opens preview modal.
2. Tabbing to a sheet card and pressing Enter activates the same click action.
3. Tabbing to a sheet card and pressing Space activates the same click action.
4. Star-badge and menu buttons inside cards are unaffected.
5. All existing tests continue to pass.
6. New unit tests cover keyboard activation for all three view modes.
