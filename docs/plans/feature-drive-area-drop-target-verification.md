# Manual Verification: Drive Area Drag-and-Drop (Issue #6)

## Prerequisites

- [ ] Feature flag `feature.drive.area-drop-target` enabled:
      Set `NEXT_PUBLIC_FEATURE_DRIVE_AREA_DROP_TARGET=true` in `.env.local` and restart dev server.
- [ ] At least one test file available on your desktop or file manager to drag.

## Steps to Verify

### Happy Path

1. Open the Drive app in the browser (`/drive`).
2. Open your OS file manager (Finder / Explorer) alongside the browser.
3. Drag a file from the file manager and hover it over any part of the drive view
   (header area, file grid, quick access section, empty area).
4. Observe: a dashed accent-coloured border appears around the entire drive area,
   and a "Drop to upload" pill appears at the bottom centre of the screen.
5. Drop the file anywhere in the drive view.
6. Observe: the visual indicator disappears immediately on drop.
7. Observe: the Upload panel opens automatically and the file starts uploading.
8. Wait for the upload to complete — the progress bar fills and a green checkmark appears.
9. Click "Done" to close the panel.
10. Observe: the file appears in the file grid.

### Multiple Files

1. Select multiple files in the file manager.
2. Drag and drop them all onto the drive area at once.
3. Observe: all files appear in the Upload panel queue and upload in parallel.

### Edge Cases

#### Drag leaves the window

1. Start dragging a file over the drive area (the border should appear).
2. Move the cursor out of the browser window without dropping.
3. Observe: the drag-over visual state clears (no stuck border).

#### No files in drop (e.g. text drag)

1. Select some text on any webpage.
2. Try to drag it over the drive area.
3. Observe: the drag-over border does NOT appear and nothing happens on drop.

#### Empty drop target

1. Drag a file over the drive area.
2. Drop it with no actual files attached (very hard to do manually — covered by tests).
3. Observe: the UploadZone does NOT open.

### Feature Flag Off

1. Remove `NEXT_PUBLIC_FEATURE_DRIVE_AREA_DROP_TARGET=true` from `.env.local`
   (or set it to `false`) and restart the dev server.
2. Drag a file over the drive area.
3. Observe: no drag-over border appears.
4. Drop the file.
5. Observe: the Upload panel does NOT open automatically.
6. Confirm: the Upload button still works normally when clicked.
7. Re-enable the flag for subsequent testing.

## Expected Results

- With flag ON: anywhere in the drive view accepts file drops; visual feedback is immediate;
  upload begins without the user needing to click the Upload button.
- With flag OFF: behaviour identical to before this change; only the Upload button and its
  internal DropZone accept files.

## Rollback

Disable `NEXT_PUBLIC_FEATURE_DRIVE_AREA_DROP_TARGET` — instant rollback, no deployment required.
