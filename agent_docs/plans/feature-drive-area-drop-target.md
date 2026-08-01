# Plan: Drive Area-Wide Drag-and-Drop (Issue #6)

## What is changing and why

Currently in the Drive app (`apps/web/src/app/(apps)/drive/page.tsx`), files can only be
drag-dropped inside the `UploadZone` modal (which uses the `DropZone` primitive from
`@neutrino/ui`). The entire drive view should be a drop target so users can drag files from
their OS file manager and drop them anywhere in the drive area to start an upload.

## Layers affected

- **Frontend only** — the change is entirely in the drive page component and its CSS module.
  No backend, no API changes, no design-token changes.

## Agents used

- `frontend-developer` — adds drag-and-drop event handling to the page container
- `ui-designer` — adds a visual drag-over overlay (CSS) to the page container
- `test-writer` — writes unit tests for the new behaviour

## Feature flag

- Name: `feature.drive.area-drop-target`
- Implementation: `featureFlags.driveAreaDropTarget`
- Env var: `NEXT_PUBLIC_FEATURE_DRIVE_AREA_DROP_TARGET`
- Default: off in all environments

## Implementation plan

### `featureFlags.ts`
Add `driveAreaDropTarget` flag.

### `page.tsx` — `DrivePage`
1. When `featureFlags.driveAreaDropTarget` is on, attach `onDragOver`, `onDragLeave`, and
   `onDrop` handlers to the root `.page` div.
2. `onDragOver` — call `e.preventDefault()`, set `isDraggingOver` state to `true`.
3. `onDragLeave` — only clear flag when leaving the root element (check
   `e.relatedTarget` is not a descendant).
4. `onDrop` — call `e.preventDefault()`, extract `e.dataTransfer.files`, enqueue them the
   same way the Upload button does (open `UploadZone` pre-populated, or extract the
   `enqueueFiles` logic into a shared hook). The simplest correct approach:
   - Open the `UploadZone` overlay (`setUploadOpen(true)`) so progress is visible.
   - Then call the upload enqueue logic directly. To avoid duplicating the mutation, we lift
     `enqueueFiles` out of `UploadZone` into a callback prop `initialFiles?: File[]` so that
     when the zone opens it immediately enqueues.
   - Alternative (chosen for simplicity): add an `initialFiles` prop to `UploadZone` that,
     on mount, immediately calls `enqueueFiles` with those files.
5. Show a visual overlay on the page container when dragging over (`.page--drag-over` CSS class).

### `UploadZone.tsx`
Add optional `initialFiles?: File[]` prop. On mount, if provided, call `enqueueFiles`.

### `page.module.css`
Add drag-over overlay styles.

## Known risks and edge cases

- `dragLeave` fires when moving between child elements — use `relatedTarget` check.
- Drop from the browser's own elements (e.g. dragging a text link) — guard with
  `e.dataTransfer.files.length > 0`.
- When modals are open, the drag target should still be the page behind — the overlay
  `z-index` of `UploadZone` is above the drag overlay.

## Acceptance criteria

- Dragging a file anywhere over the drive page shows a visual highlight on the page area.
- Dropping the file opens the `UploadZone` panel and immediately starts uploading.
- Upload uses the same E2EE / plaintext path as the regular upload button.
- Feature is gated by `NEXT_PUBLIC_FEATURE_DRIVE_AREA_DROP_TARGET=true`.
- When flag is off, existing behaviour is unchanged.
- Tests cover: drag-over sets state, drag-leave clears state, drop opens upload zone and
  triggers enqueue.
