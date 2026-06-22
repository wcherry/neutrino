# Photos App — Implementation Plan

## Branch
`photos-app`

## What is changing and why

Building a standalone Photos editor at `/photos/editor?fileId=<driveFileId>` that lets users open image files from drive and perform Phase 1 editing operations entirely client-side. The existing `/photos/edit` route uses an old `photosApi` (server-backed edits) and is separate — the new editor lives at `/photos/editor`.

## Layers affected

- **Frontend** — all new editor components under `web/apps/web/src/app/(apps)/photos/editor/`
- **Drive routing** — three spots in drive pages need `image/*` MIME routing to the new editor
- **Sidebar** — add Photos nav entry to layout
- **Design** — CSS module for the editor layout

## Route structure

```
web/apps/web/src/app/(apps)/photos/editor/
  page.tsx              ← Suspense wrapper (pattern: drawing/editor/page.tsx)
  PhotoEditor.tsx       ← main client component, owns all state
  PhotoCanvas.tsx       ← canvas rendering + tool interaction (forwardRef)
  PhotoToolbar.tsx      ← left sidebar tool picker
  PhotoTopBar.tsx       ← top bar: back, title, save/export buttons
  AdjustmentsPanel.tsx  ← right panel: 6 adjustment sliders
  page.module.css       ← layout styles
```

## Drive routing changes

### `drive/page.tsx`
- In `handleGridItemClick` (~line 297-309): add `else if (file.mimeType.startsWith('image/'))` branch before the final `setPreviewFile` fallback, routing to `/photos/editor?fileId=${file.id}`
- In the starred files `onClick` (~line 565-580): same image check before `setPreviewFile`
- Context menu `onPreview` (~line 687-700): leave the final `setPreviewFile(f)` fallback as-is (images fall through to preview modal on right-click Preview)

### `drive/shared/page.tsx`
- In `openFile` (~line 48-62): add `else if (file.mimeType.startsWith('image/'))` before the `setPreviewFile` fallback

## Sidebar
- `web/apps/web/src/app/(apps)/layout.tsx` contains `BASE_NAV_SECTIONS`
- Add `{ id: 'photos', label: 'Photos', icon: Image, href: '/photos' }` to the main section (use `Image` from lucide-react)

## Architecture

### PhotoEditor state
- `fileId` from searchParams
- `fileName` — loaded from file metadata or inferred
- `imageDataUrl` — result of loading blob → FileReader
- `adjustments` — `{ brightness, contrast, saturation, exposure, temperature, sharpness }` all 0 by default
- `rotation` — degrees: 0 | 90 | 180 | 270
- `flipH`, `flipV` — booleans
- `cropRect` — `{ x, y, w, h }` normalized 0..1 (null = no crop)
- `activeTool` — 'select' | 'crop' | 'pen' | 'highlighter' | 'arrow' | 'rectangle' | 'circle' | 'line' | 'text' | 'eraser' | 'blur' | 'pixelate' | 'blackbox'
- `markupStrokes` — array of drawn overlay elements
- `isDirty` — true when edits unsaved

### PhotoCanvas
- Two stacked canvases: base (image + adjustments) and overlay (markup)
- Base canvas: apply rotation/flip via ctx transforms, then draw image, apply CSS filter for adjustments
- Overlay canvas: captures mouse events for tool drawing
- forwardRef exposing `getExportBlob(): Promise<Blob>` (merges both canvases)

### Save flow
- `getExportBlob()` → canvas.toBlob() merging base + overlay
- Convert blob to File with original filename
- `storageApi.uploadFile(file, undefined, null)` — re-uploads to same fileId is not directly supported; instead use the drive upload API to overwrite (check if there's a PATCH/PUT for file content — if not, use a new upload and update the reference in the URL)
- Actually: use `storageApi.uploadFile` to create a new file (the existing API doesn't support in-place overwrite of content). The save button will upload the edited file as a new file. A simpler approach: fetch the file metadata to get folderId, then upload with the same name to same folder.

### Export flow
- `getExportBlob()` → `URL.createObjectURL` → trigger `<a download>` click

### Adjustments rendering
- Apply via canvas `filter` property on the base canvas context before drawing:
  `ctx.filter = 'brightness(x) contrast(x) saturate(x) ...`
- Temperature: warm = increase red channel, cool = increase blue channel — implemented by drawing the image then applying a color overlay with globalCompositeOperation

### Drag and drop
- Drop zone on the canvas area: `onDrop` handler reads `dataTransfer.files[0]`, loads as data URL, replaces the current image

### Clipboard paste
- `document.addEventListener('paste')` in PhotoEditor → reads `e.clipboardData.files[0]` if it's an image

## Key implementation notes
- Use `@neutrino/ui` Button, Spinner, useToast — no custom primitives
- Sliders: use native `<input type="range">` (same as existing photo edit page)
- No feature flags
- No autosave after failed load

## Acceptance criteria
- Opening an image file from drive navigates to `/photos/editor?fileId=<id>`
- Image loads and displays in the canvas
- Adjustment sliders change the image appearance in real time
- Rotate left/right, flip H/V work
- Crop tool shows draggable overlay, Apply crop updates the canvas
- Markup tools draw on the overlay canvas
- Save re-uploads the edited image to drive
- Export downloads the merged canvas as PNG
- Drag and drop replaces the image
- Clipboard paste replaces the image
- Photos appears in the sidebar nav
