# Manual Verification: Photos Editor

## Prerequisites
- [ ] Dev server running (`pnpm dev` from `/Users/williamcherry/neutrino/web`)
- [ ] At least one image file (JPG/PNG/WebP) uploaded to your Drive

## Steps to Verify

### Sidebar navigation
1. Open the app in a browser
2. Verify "Photos" appears in the left sidebar between "Notes" and "Diagrams"
3. Click "Photos" — it should navigate to `/photos` (the existing photos gallery page)

### Opening an image from Drive
1. Navigate to `/drive`
2. Upload or locate an image file (e.g. `.jpg`, `.png`, `.webp`)
3. Double-click the image file (grid click)
4. Verify the browser navigates to `/photos/editor?fileId=<id>`
5. Verify the image loads and displays in the dark canvas area

### Opening from Starred files
1. Star an image file in Drive
2. In the Drive page, find the starred files section
3. Click the starred image file
4. Verify it opens in `/photos/editor?fileId=<id>`

### Opening from Shared with me
1. Navigate to `/drive/shared`
2. If there are shared image files, click one
3. Verify it opens in `/photos/editor?fileId=<id>`

### Context menu Preview (should still use PreviewModal)
1. In Drive, right-click an image file
2. Select "Preview"
3. Verify the inline `PreviewModal` opens (not the editor)

### Happy Path — Adjustments
1. Open an image in the editor
2. Move the Brightness slider to +50 — image should get brighter in real time
3. Move the Contrast slider to -30 — image should get lower contrast
4. Move the Saturation slider to -100 — image should become desaturated
5. Move the Temperature slider to +100 — image should get a warm orange tint
6. Move the Temperature slider to -100 — image should get a cool blue tint
7. Click "Reset all" — all sliders should return to 0

### Happy Path — Rotation & Flip
1. Click "CCW" button in Orientation section — image rotates 90° counter-clockwise
2. Click "CW" button — image rotates 90° clockwise
3. Click "Flip H" — image mirrors horizontally (button stays highlighted/active)
4. Click "Flip V" — image mirrors vertically (button stays highlighted/active)
5. Click the active "Flip H" again — flip is removed

### Happy Path — Toolbar Tools
1. Click the Crop tool (scissors icon) in the left toolbar — button highlights
2. Drag on the canvas to draw a crop area — a dashed white rectangle should appear
3. Release — the image should be cropped to that region
4. Click the Pen tool
5. Draw on the canvas — red strokes appear on the overlay
6. Click the Highlighter tool
7. Draw on the canvas — semi-transparent strokes appear
8. Click the Rectangle tool
9. Drag to draw a rectangle outline on the canvas
10. Click the Circle tool, drag to draw an ellipse
11. Click the Arrow tool, drag to draw an arrow with arrowhead
12. Click the Black Box tool, drag to redact a region with a black rectangle

### Happy Path — Export
1. Click the "Export" button in the top bar
2. Verify a PNG file downloads to your computer
3. Open the downloaded file — it should show the edited image (adjustments + markup applied)

### Happy Path — Save
1. Make any adjustment (e.g. brighten the image)
2. Verify "Unsaved changes" label appears in the top bar
3. Click "Save"
4. Verify "Save" button shows "Saving..." briefly then "Save" returns
5. Verify "Unsaved changes" label disappears
6. Verify a success toast appears
7. Navigate to Drive and find the file — it should still exist (uploaded as a new file with same name)

### Drag and Drop
1. With the editor open, drag an image file from your computer onto the canvas area
2. Verify the new image replaces the current one
3. Verify "Unsaved changes" appears

### Clipboard Paste
1. Copy an image to clipboard (e.g. screenshot with Cmd+Ctrl+Shift+4 on macOS)
2. Click in the editor and press Cmd+V
3. Verify the pasted image replaces the current canvas image

### Edge Cases

#### No fileId in URL
1. Navigate to `/photos/editor` (no query params)
2. The editor should show a loading state then display the empty canvas without crashing

#### Invalid fileId
1. Navigate to `/photos/editor?fileId=invalid-id-that-doesnt-exist`
2. Verify the error state shows "Failed to load image"
3. Verify "Go back" link works and there is no autosave

## Expected Results
- Dark chrome UI (dark backgrounds, light text) always visible regardless of app theme
- All adjustments apply in real time with no lag on small/medium images
- Left toolbar: 13 tool buttons in 3 groups (selection/crop, markup, redaction)
- Right panel: 4 sections (Light, Color, Detail, Orientation)
- Top bar: back arrow, file name, Export and Save buttons
