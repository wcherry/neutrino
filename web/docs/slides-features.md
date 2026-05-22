# Slides Module Feature Inventory

Last reviewed: 2026-05-20

## Scope

The Slides module covers the presentation list at `apps/web/src/app/(apps)/slides/page.tsx`, the editor at `apps/web/src/app/(apps)/slides/editor`, shared preview support in `DocumentPreviewModal`, and the `@neutrino/api-slides` client package.

## Presentation Library

- Lists existing presentations in the shared `FileGrid` with presentation icons, modified dates, sorting by modified date, loading/error states, and an empty state.
- Creates a new presentation named `Untitled presentation` and opens it directly in the editor.
- Imports `.pptx` files from the library page by creating a new presentation, dynamically loading the PPTX importer, and routing into the editor.
- Initializes end-to-end encryption for newly created/imported presentations when the current user has a local key pair; failures fall back non-fatally to plaintext editing.
- Supports file-context actions through Drive components:
  - preview
  - file info
  - sharing
  - rename
  - star/unstar
  - download JSON
  - delete
  - copy editor link
  - move to folder
- Downloads encrypted presentations by decrypting with the user's key pair; downloads plaintext presentations through the storage API.

## Editor Shell

- Opens a presentation by `id` query parameter at `/slides/editor?id=...`.
- Loads presentation metadata and JSON content separately.
- Resolves encrypted content with `useEncryptedDocumentContent`; if a DEK is available, reads/writes encrypted `slide.json`, otherwise uses plaintext Drive content URLs.
- Autosaves content changes after a 2-second debounce and exposes save states: saved, saving, unsaved, and error.
- Saves title changes on blur or Enter.
- Invalidates the slides list after content/title saves so the library reflects updates.
- Provides top-level actions for:
  - returning to the Slides list
  - toggling Slide Master mode
  - importing PPTX into the current presentation
  - exporting PowerPoint
  - entering presenter mode

## Slide Management

- Shows a left-side slide thumbnail rail with slide numbers and transition badges.
- Adds a new slide after the selected slide using the active theme background and default transition.
- Duplicates the selected slide, including cloned elements with new IDs.
- Deletes the selected slide while preventing deletion of the final remaining slide.
- Moves slides up/down with footer controls.
- Reorders slides with drag and drop in the thumbnail rail.
- Tracks the selected slide and clears element selection when switching/reordering as needed.

## Canvas Editing

- Renders slides as a 16:9 canvas with percentage-based element positioning.
- Supports selectable, draggable, and resizable elements with eight resize handles.
- Supports text elements:
  - add text box
  - double-click to edit text
  - spell-check setting integration
  - bold, italic, underline
  - font family
  - font size increase/decrease
  - left/center/right alignment
  - text color
  - delete
- Supports shape elements:
  - quick-add rectangle and circle from the toolbar
  - larger shape catalog in the Shapes side tab
  - fill color editing
  - delete
- Shape catalog includes general shapes, arrows, and callouts.
- Supports sheet embed elements pasted from Sheets:
  - paste choice dialog for table vs live embed
  - cached sheet data persistence
  - cache refresh callback
  - convert embed to static text table
  - remove embed

## Layouts, Themes, And Master Styling

- Provides a Layout side tab with preview cards and preset slide layouts:
  - Blank
  - Title Slide
  - Title & Content
  - Title Only
  - Section Header
  - Two Column
  - Comparison
  - Content & Caption
  - Big Statement
  - Quote
- Applying a layout replaces the current slide's elements with layout-generated elements styled from the active theme and slide master.
- Provides a Theme side tab backed by `/api/v1/slides/themes`.
- Applying a theme updates presentation theme metadata, slide backgrounds, slide transitions, text colors/fonts, and shape fills.
- Supports slide master editing for:
  - master background color
  - title font size, bold, and color
  - body font size, bold, and color
  - applying master background/text styles across all slides

## Backgrounds, Transitions, Animations, And Zoom

- Per-slide background picker supports:
  - solid color
  - preset gradients
  - custom CSS gradient string
  - image URL background
- Per-slide transitions include:
  - none
  - fade
  - dissolve
  - slide right
  - slide left
  - flip
  - cube
  - gallery
  - pixelate
  - cover
  - wipe
  - zoom
- Selected elements can receive entry animations:
  - none
  - fade in
  - fly in
  - zoom in
- Fly-in animations support direction selection: left, right, top, bottom.
- Animated elements support duration and delay controls in milliseconds.
- Canvas zoom supports fixed steps: 25%, 50%, 75%, 100%, 125%, 150%, and 200%, with reset to 100%.

## Presenter Mode

- Full presenter view renders the current slide with its background, text, shapes, and element animations.
- Supports slide navigation with previous/next controls.
- Displays slide count/progress.
- Shows a next-slide preview panel.
- Shows speaker notes for the active slide.
- Applies visual classes for supported slide transitions.

## Speaker Notes

- Notes side tab edits the current slide's speaker notes.
- Notes are persisted in slide JSON.
- Notes are shown in presenter mode.
- Notes are imported from PPTX notes slides when present.
- Notes are exported into PowerPoint files.

## PowerPoint Import And Export

- PPTX import is dynamically loaded to keep the initial slides bundle smaller.
- Import enforces a 100 MB file size limit.
- Import parses slide XML from `.pptx` packages.
- Import extracts:
  - slide order
  - background solid color
  - text boxes
  - text position and size
  - font size, bold, italic, underline
  - text color and alignment
  - speaker notes
- Import falls back to a default presentation when no slides are found.
- PPTX export uses `pptxgenjs` with a 16:9 layout.
- Export writes:
  - slide backgrounds for color and image backgrounds
  - text elements with formatting
  - shape elements as rectangles using fill/stroke
  - speaker notes
- Export currently treats gradient backgrounds as white in the generated PPTX.

## Preview And Sharing Integration

- Slides can be previewed through `DocumentPreviewModal`.
- Preview loads slide metadata and JSON content, parses the presentation, and renders a read-only list of slide thumbnails.
- Preview supports parse, loading, empty, and error states.
- Shared slide links route through the share token client into `/slides/editor?id=...`.

## API Client Surface

- `slidesApi` supports:
  - list presentations
  - create presentation
  - get presentation metadata/content URLs
  - save presentation title
  - list, create, update, and delete slide themes
- `slidesAI` exposes endpoints for:
  - smart text completion
  - Drive image search
  - design suggestions
  - autoformat

## Supporting Code Not Currently Surfaced In The Editor

- `AIPanel.tsx` implements an AI assistant UI for smart compose, Drive image search, and design suggestions.
- The AI panel uses the `slidesAI` client, but the current `SlideEditor.tsx` does not import or render `AIPanel`, and the autoformat client method is not wired to a visible editor action.

## Current Limitations Visible From The Code

- PPTX import focuses on text boxes, solid backgrounds, and notes; it does not recreate arbitrary PowerPoint shapes, images, charts, animations, or transitions.
- PPTX export serializes all shape elements as rectangles, regardless of the in-editor shape type.
- PPTX export does not preserve gradient backgrounds.
- Presentation preview reads plaintext content through `driveReadContent`; encrypted presentation preview may require additional encrypted-content handling to work consistently.
- Imported PPTX content on the library page creates a new slide file but does not appear to persist the imported presentation JSON before routing into the editor; the editor-level import path does persist via autosave.
