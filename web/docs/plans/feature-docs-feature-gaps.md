# Implementation Plan: Docs Feature Gaps

Branch: `feature/docs-feature-gaps`

## Summary

Implements four remaining feature gaps for the Neutrino docs editor:

1. **Real-time presence / cursor awareness** — Yjs awareness protocol integrated on the frontend to show remote cursors with colored name labels and a presence strip of connected user avatars.
2. **Track changes / suggesting mode** — A custom Tiptap extension that records insertions (green) and deletions (red strikethrough) as marks; a UI to accept/reject individual changes or all at once.
3. **Document compare / revision compare** — A diff viewer that fetches two version snapshots and shows an inline character-level diff. Triggered from the VersionHistoryPanel as a "Compare" action.
4. **Mobile / responsive editing** — Media-query responsive styles so the editor is usable on phones: collapsing toolbar, touch-friendly tap targets, readable page area on small viewports.

---

## Layers affected

| Feature | Backend (Rust) | Frontend TS/TSX | CSS |
|---|---|---|---|
| Presence / cursors | No change needed — backend already broadcasts awareness messages | `usePresence` hook, `PresenceBar` component, cursor overlay marks | Cursor/avatar CSS |
| Track changes | No change | `TrackChangesExtension`, `TrackChangesBar` | Extension marks CSS |
| Compare | `GET /api/v1/drive/files/{id}/versions/{versionId}/content` endpoint needed (backend) | `DocComparePanel` component, diff logic | Compare panel CSS |
| Mobile | No change | Toolbar adjustments | `@media (max-width: 768px)` rules in `page.module.css` |

---

## Feature flags

| Flag | Env var | Default | Purpose |
|---|---|---|---|
| `docsPresence` | `NEXT_PUBLIC_FEATURE_DOCS_PRESENCE` | `false` | Real-time presence & cursors |
| `docsTrackChanges` | `NEXT_PUBLIC_FEATURE_DOCS_TRACK_CHANGES` | `false` | Track changes / suggesting mode |
| `docsCompare` | `NEXT_PUBLIC_FEATURE_DOCS_COMPARE` | `false` | Version compare viewer |
| `docsMobileEditor` | `NEXT_PUBLIC_FEATURE_DOCS_MOBILE_EDITOR` | `false` | Mobile / responsive layout |

---

## Architecture decisions

### Feature 1: Presence / cursor awareness

The backend's `collab/api.rs` already passes through awareness messages (type `1`) verbatim to all peers in the room. No backend changes needed.

Frontend:
- `usePresence(docId, userName, userColor)` hook — creates a `WebSocket` connection to `/api/v1/docs/{id}/ws`, sends awareness updates on cursor/selection changes and receives awareness state from peers. Uses the Yjs awareness protocol (message type 1).
- Does NOT depend on `yjs` / `@tiptap/extension-collaboration` being installed in the frontend bundle (those are not currently installed). Instead we implement a minimal awareness protocol:
  - Awareness message wire format: `[varint 1][varint payload_len][payload_bytes]`
  - Payload: JSON bytes (simple, human-readable), not the binary Yjs awareness CRDT, since the backend just forwards bytes between clients without interpretation.
  - Each client sends `{ clientId, user: { name, color }, cursor: { anchor, head } | null }`.
  - `PresenceBar` renders colored avatar circles in the topbar.
  - `PresenceCursors` renders remote cursor caret overlays using ProseMirror decorations.

### Feature 2: Track changes

No Tiptap pro extension needed. Implement as a custom Tiptap Extension:
- Two marks: `trackedInsertion` (green background) and `trackedDeletion` (red strikethrough, `contentEditable: false` so the text stays visible but can't be edited).
- `TrackChangesExtension` — in suggesting mode, intercepts all text insertions/deletions via `appendTransaction` and wraps them in the appropriate mark instead of actually deleting.
- Exported commands: `toggleSuggestingMode()`, `acceptChange(from, to)`, `rejectChange(from, to)`, `acceptAllChanges()`, `rejectAllChanges()`.
- `TrackChangesBar` — thin bar below the toolbar showing "Suggesting" badge, and Accept All / Reject All buttons.
- Individual accept/reject via right-click context menu item when cursor is on a tracked-change mark.

### Feature 3: Version compare

The backend `storageApi` only has `listVersions` and `restoreVersion`. We need a way to read the *content* of a specific version. The drive file download endpoint `/api/v1/drive/files/{id}/download?version={versionId}` likely already exists (or can be inferred from how `driveReadContent` works). We'll add `storageApi.downloadVersion(fileId, versionId)` using the existing URL pattern `/api/v1/drive/files/{id}/versions/{versionId}/download`.

Frontend:
- `DocComparePanel` component — side panel (matches style of `CommentsPanel` / `VersionHistoryPanel`).
- Receives `baseVersionId` and `compareVersionId` as props; fetches both content blobs; extracts plain text (JSON → TipTap text content); runs a char-level diff; renders inline with `<ins>` / `<del>` markup.
- The diff algorithm: simple Myers-diff on words (no extra library needed — implement a word-level LCS diff).
- VersionHistoryPanel gets a "Compare" button next to each version; clicking sets a `compareVersionId` in DocEditor state and shows the compare panel.

### Feature 4: Mobile / responsive

CSS-only feature (no JS logic change):
- `@media (max-width: 768px)` block in `page.module.css`:
  - Topbar: hide `saveStatus` text, collapse title input width, reduce padding.
  - Toolbar: wrap with `overflow-x: auto; -webkit-overflow-scrolling: touch` and slightly larger tap targets (`min-width: 36px; min-height: 36px`).
  - `editorScroll`: reduce padding to `8px`.
  - `page`: full-width (`width: 100% !important; border-radius: 0`), reduced padding.
  - `outlinePanel`: hidden on mobile (width 0), accessed via a toggle button.
  - Status bar: simplified.

---

## Acceptance criteria

- [ ] Presence bar shows connected users' avatars when two browser tabs are open to the same doc (with `docsPresence` flag on).
- [ ] Remote cursors are visible as colored carets in the editor.
- [ ] Toggling "Suggesting mode" on and typing records insertions in green; deleting records deletions in red strikethrough.
- [ ] Accept/Reject all changes works; individual accept/reject via context menu works.
- [ ] "Compare" button appears in VersionHistoryPanel (with `docsCompare` flag on); clicking opens a diff view.
- [ ] On a 375px-wide viewport, the editor page is readable and the toolbar is horizontally scrollable.
- [ ] All existing tests continue to pass.

---

## Known risks

- The presence WebSocket connection runs alongside the existing autosave mechanism. Both read the same `docId`/`authToken`. The awareness WS will NOT send document state updates — it only sends awareness messages. We need to make sure `pendingContent` autosave is unaffected.
- Track changes `appendTransaction` must be guarded to avoid infinite loops (only intercept user input transactions, not programmatic ones).
- Version compare requires a new backend endpoint or confirming the existing download path supports `?version=` query param.
