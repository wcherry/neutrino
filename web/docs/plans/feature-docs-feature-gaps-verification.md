# Manual Verification: Docs Feature Gaps (4 features)

## Prerequisites
- Run the backend and frontend: `cargo run` + `pnpm dev`
- Enable all four feature flags in your environment:
  - `NEXT_PUBLIC_FEATURE_DOCS_PRESENCE=true`
  - `NEXT_PUBLIC_FEATURE_DOCS_TRACK_CHANGES=true`
  - `NEXT_PUBLIC_FEATURE_DOCS_COMPARE=true`
  - `NEXT_PUBLIC_FEATURE_DOCS_MOBILE_EDITOR=true`
- Or toggle flags via the feature-flag service API

---

## Feature 1: Real-time Presence / Cursor Awareness

**Flag:** `docsPresence` (`NEXT_PUBLIC_FEATURE_DOCS_PRESENCE`)

### Happy Path
1. Open a document in one browser tab.
2. Open the same document in a second browser tab (or different browser).
3. Verify a colored avatar circle appears in the top-right of the first tab.
4. Move the cursor in the second tab — verify a colored caret with a name label appears in the first tab at the correct position.
5. Close the second tab — verify the avatar disappears.

### Edge Cases
1. Open with no other users — verify "● You" indicator appears.
2. Disconnect the network — verify presence gracefully shows nothing (no crash).

### Feature Flag Off
1. Disable `docsPresence`.
2. Open two tabs on the same doc — no avatars or remote cursors appear.

---

## Feature 2: Track Changes / Suggesting Mode

**Flag:** `docsTrackChanges` (`NEXT_PUBLIC_FEATURE_DOCS_TRACK_CHANGES`)

### Happy Path
1. Open a document.
2. A yellow banner bar appears below the toolbar showing "Editing".
3. Click "Editing" to switch to "Suggesting" mode — banner turns green, shows "Suggesting".
4. Type new text — it appears with a green background.
5. Delete some existing text — the deleted text remains visible with a red strikethrough.
6. Click "Accept all" — all tracked insertions are finalized, tracked deletions are removed.
7. Switch to suggesting mode again, make changes, then click "Reject all" — inserted text is removed, deleted text is restored.

### Edge Cases
1. Mixed accept/reject — right-click on a specific tracked change to see context menu options (if implemented via future iteration; for now Accept All / Reject All are the primary flow).
2. Save in suggesting mode — content with tracked marks is preserved.

### Feature Flag Off
1. Disable `docsTrackChanges`.
2. No yellow bar appears; no track changes functionality.

---

## Feature 3: Document Compare / Revision Compare

**Flag:** `docsCompare` (`NEXT_PUBLIC_FEATURE_DOCS_COMPARE`)

### Happy Path
1. Open a document with at least 2 saved versions (use "Save" button to create versions).
2. Click "History" in the top bar — the version history panel opens.
3. A "Compare with current" section appears at the bottom of the history panel.
4. Click "Compare v1 — (label)" — a compare panel opens on the right.
5. The panel shows:
   - Base version label (e.g., "Draft (v1)" with date).
   - Current version label.
   - An inline diff with green highlights for additions and red strikethrough for deletions.

### Edge Cases
1. Identical versions — diff shows "No differences found".
2. Very large documents — diff renders without freezing the UI.

### Feature Flag Off
1. Disable `docsCompare`.
2. "Compare" button in the top bar and compare section in history panel are hidden.

---

## Feature 4: Mobile / Responsive Editing

**Flag:** `docsMobileEditor` (`NEXT_PUBLIC_FEATURE_DOCS_MOBILE_EDITOR`)

Note: Feature 4's CSS applies at viewport width ≤ 768px regardless of flag, since the flag controls optional JS behavior. The CSS media query is always present but styled to be useful on mobile.

### Happy Path
1. Open a document in Chrome/Firefox.
2. Open DevTools → Device toolbar → select iPhone 14 (390px wide).
3. Verify:
   - Topbar: save status text is hidden, title is readable.
   - Toolbar: scrolls horizontally, buttons are at least 36px tall/wide.
   - Editor page: full-width, minimal padding, text is readable without horizontal scroll.
   - Status bar: visible and simplified.
4. Tap inside the editor — keyboard appears, editor is scrollable.

### Edge Cases
1. Rotate to landscape — editor remains usable.
2. Outline panel: hidden on mobile (not visible).

### Feature Flag Off (mobile CSS always applies, controlled by viewport width)
1. On desktop (> 768px), no mobile styles apply — layout is identical to before.

---

## Rollback

- **Presence:** Disable `NEXT_PUBLIC_FEATURE_DOCS_PRESENCE` — no deployment needed.
- **Track changes:** Disable `NEXT_PUBLIC_FEATURE_DOCS_TRACK_CHANGES`.
- **Compare:** Disable `NEXT_PUBLIC_FEATURE_DOCS_COMPARE`.
- **Mobile:** The responsive CSS is always present in the bundle but only activates at ≤ 768px viewports (harmless on desktop).
