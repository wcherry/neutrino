# Plan: Document Preview for Docs, Sheets, Slides, and Notes

## What is changing and why

Currently, clicking any document item in its listing page navigates directly to the
full editor. There is no way to quickly inspect content without entering edit mode.
This feature adds a read-only preview modal that slides in when the user clicks a
document card, showing a faithful but lightweight render of the document content.
The user can then choose to "Open" (navigate to the editor) or dismiss the modal.

## Layers affected

- **Frontend** — four listing pages (docs, sheets, slides, notes) each get a
  preview modal component and an updated `onItemClick` handler
- **Design** — shared modal shell CSS; read-only render styles per document type
- **Tests** — unit tests for each preview component and the shared hook

## Specialist agents needed

- `frontend-developer` — modal components, data-fetching hooks, page wiring
- `ui-designer` — modal shell styles and per-document-type read-only render styles
- `test-writer` — unit tests

## Feature flag

`feature.documents.preview`  
Env var: `NEXT_PUBLIC_FEATURE_DOCUMENT_PREVIEW`  
Default: **off**

When the flag is off, clicking a document card navigates directly to the editor
(current behaviour). When on, clicking opens the preview modal instead. The modal
always contains an "Open in editor" button so navigation is never blocked.

## Implementation design

### Shared components

`apps/web/src/components/DocumentPreviewModal/`
- `DocumentPreviewModal.tsx` — modal shell (backdrop, header with title + "Open"
  button + close button, scrollable body)
- `DocumentPreviewModal.module.css` — modal shell styles
- `index.ts` — re-export

### Per-document-type preview components (inside the modal body)

| Type   | Component | Content |
|--------|-----------|---------|
| Docs   | `DocPreview.tsx`   | Tiptap editor in read-only mode, same extensions as DocEditor |
| Sheets | `SheetPreview.tsx` | Simplified read-only cell grid (no formulas, no editing) |
| Slides | `SlidePreview.tsx` | Carousel of SlideThumbnail-style panels using existing helpers |
| Notes  | `NotePreview.tsx`  | Rendered blocks using `renderInline` from blockEditorHelpers |

### Data loading

Each preview component receives the document ID. It:
1. Calls the existing `get<Type>` API to get the `contentUrl`
2. Calls `driveReadContent(contentUrl)` to fetch raw JSON
3. Parses and renders read-only

No new API endpoints are required.

### Sheet dark-theme isolation

Sheet cell `backgroundColor` styles must be applied inline and must NOT be
overridden by any dark-theme class on the modal wrapper, consistent with existing
sheet behaviour (per project constraint).

### Page wiring

Each listing page (`docs/page.tsx`, `sheets/page.tsx`, `slides/page.tsx`,
`notes/page.tsx`) gains:
- A `previewId: string | null` state variable
- An `onItemClick` that sets `previewId` when the flag is on, or navigates to the
  editor when the flag is off
- A conditional render of `<DocumentPreviewModal>` with the appropriate variant

## Acceptance criteria

- [ ] Clicking a document card while flag is on opens the preview modal
- [ ] The modal shows document title, a "Open in editor" button, and a close button
- [ ] Docs preview: document body text renders in read-only rich-text format
- [ ] Sheets preview: visible cells render with their values (no editing)
- [ ] Slides preview: all slides visible as a scrollable row of thumbnails
- [ ] Notes preview: block content renders as formatted text
- [ ] Clicking "Open in editor" navigates to the editor route
- [ ] Closing the modal (X or Escape or backdrop click) returns to the listing
- [ ] Flag off: clicking a card navigates directly to the editor (no regression)
- [ ] Sheet cell colors are not affected by any dark-mode class on the modal wrapper
