# Manual Verification: Split Feature Editors (Structural Refactor)

## Prerequisites
- No feature flag required — this is a pure structural refactor with no behavioural changes
- Run `npm run dev` in the monorepo root (`/Users/williamcherry/neutrino-repos/neutrino-web`)
- Sign in to the application at `http://localhost:3000`

## Slide Editor

### Happy Path — Basic Editing
1. Navigate to the Slides app
2. Open or create a presentation
3. Verify the slide editor renders without blank screen or console errors
4. Double-click a text element — confirm the textarea becomes active and you can type
5. Click and drag a text element — confirm it moves on the canvas
6. Drag a resize handle — confirm the element resizes correctly
7. Click the background (BG) button — confirm the BackgroundPicker popover opens with Color / Gradient / Image tabs
8. Select a gradient preset — confirm the slide background updates immediately

### Happy Path — Slide Management
1. Add a new slide via the sidebar
2. Reorder slides by dragging in the thumbnail panel
3. Verify slide thumbnails render the correct background and element previews
4. Delete a slide — confirm it is removed from the panel and the adjacent slide becomes active

### Happy Path — Shape Insertion
1. Open the shape picker and insert a shape
2. Confirm the shape renders on the canvas using an SVG path
3. Select and resize the shape with corner/edge handles

### Happy Path — Presenter View
1. Click "Present" to launch presenter view
2. Confirm the current slide fills the main area
3. Confirm the next-slide preview and speaker notes appear in the sidebar
4. Press ArrowRight / Space — confirm advance to the next slide
5. Press ArrowLeft — confirm navigation to the previous slide
6. Press Escape — confirm return to the editor

### Happy Path — PPTX Export / Import
1. Export the presentation as PPTX — confirm a `.pptx` file is downloaded
2. Import a `.pptx` file via drag-drop or file picker — confirm slides are imported without errors

### Happy Path — Theme & Layout Panels
1. Open the Themes panel — confirm `ThemePreview` tiles render with the correct colour palette
2. Open the Layouts panel — confirm `LayoutPreview` tiles render placeholder rectangles

### Edge Cases
1. A slide with no elements — confirm the empty canvas renders without errors
2. A presentation with a single slide — confirm the Presenter View hides the next-slide panel and disables the forward button

---

## Calendar

### Happy Path — Month View
1. Navigate to the Calendar app
2. Confirm the month grid renders with correct day labels
3. Create a new event by clicking a day cell and filling the modal — confirm it appears on the grid
4. Edit the event — confirm changes are saved
5. Delete the event — confirm it is removed from the grid

### Happy Path — Week View
1. Switch to Week view — confirm events are displayed in the correct time slots
2. Verify day column headers show the correct dates

### Happy Path — Agenda View
1. Switch to Agenda view — confirm events are listed in chronological order

### Happy Path — Reminders
1. Open the Reminders sidebar — confirm pending reminders are listed
2. Create a reminder via the Reminders modal — confirm it appears in the sidebar
3. Mark a reminder as done — confirm it is no longer shown as overdue

### Happy Path — ICS Import
1. Drag a `.ics` file onto the calendar — confirm events are parsed and displayed

### Edge Cases
1. A month with no events — confirm the empty grid renders without console errors
2. An overdue reminder — confirm it renders with the overdue visual indicator

---

## Notes / Block Editor

### Happy Path — Block Editing
1. Navigate to the Notes app and open a note
2. Confirm the block editor renders all existing blocks correctly
3. Type in an existing block — confirm the content updates
4. Press Enter at the end of a block — confirm a new empty block is created below
5. Use the slash command menu (type `/`) — confirm the command palette appears with the expected options
6. Insert a heading block and a list block — confirm they render with correct formatting

### Happy Path — Table Blocks
1. Insert a table block via slash commands
2. Verify the table renders with the correct number of rows and columns
3. Tab through cells to navigate
4. Add a row — confirm the table grows
5. Delete a row — confirm the table shrinks

### Happy Path — Wiki Links
1. Type `[[` in a block — confirm the wiki-link autocomplete appears
2. Select a note from the suggestions — confirm the link is inserted inline

### Happy Path — Inline Rendering
1. Confirm bold (`**text**`), italic (`_text_`), code (`` `text` ``), and link (`[text](url)`) inline patterns render correctly

### Edge Cases
1. An empty note (no blocks) — confirm the editor starts with a default empty block without errors
2. Drag to reorder blocks — confirm the order is preserved after drop

---

## Rollback
This is a structural refactor with no feature flag. To roll back:
1. `git revert` the commit on `refactor/split-feature-editors` and merge the revert, or
2. Merge `main` into the branch and discard all changed files by restoring their pre-refactor state from git history.

There is no runtime toggle — if a regression is found, it must be fixed in code or the branch must not be merged.
