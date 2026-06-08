# Manual Verification: Diagramming App (Phases 1-3)

## Prerequisites

- Stack running locally via docker-compose-dev.yml (or `cargo run` + `pnpm dev`)
- `FEATURE_DIAGRAMS_APP=true` set in the environment
- A registered user account

## Steps

### 1. Feature flag disabled (default state)

1. Ensure `FEATURE_DIAGRAMS_APP` is NOT set (or set to `false`).
2. Navigate to `/diagrams`.
3. Expected: A "Diagrams coming soon" message is shown (not a diagram list).
4. The Diagrams nav item is visible in the sidebar but the page shows the disabled state.
5. The FAB "New diagram" action is visible but attempts to create a diagram should fail with an API error from the backend (routes not registered).

### 2. Feature flag enabled

1. Set `FEATURE_DIAGRAMS_APP=true` and restart the backend.
2. Navigate to `/diagrams`.
3. Expected: An empty state with "No diagrams yet" and a "New diagram" button.

### 3. Create a new diagram (happy path)

1. Click "New diagram" on the `/diagrams` page.
2. Expected: You are redirected to `/diagrams/editor?id=<uuid>`.
3. The editor loads with a blank canvas, "Page 1" tab at the bottom, left shape panel, and right properties panel.
4. The title shows "Untitled diagram".

### 4. Add shapes

1. In the shape panel on the left, click "Rectangle" under Basic shapes.
2. Expected: A rectangle is added to the canvas at approximately the center.
3. Click and drag the rectangle to move it.
4. Double-click the rectangle and type a label (e.g. "Step 1"). Press Enter.
5. The rectangle should show the label "Step 1".
6. Add an Ellipse shape and move it near the rectangle.
7. Expected: Both shapes visible, shapes can be selected and moved independently.

### 5. Connectors

1. Select the Connector tool in the toolbar (diagonal line icon).
2. Click on the center of the Rectangle shape, then click on the Ellipse.
3. Expected: A connector line appears between the two shapes with an arrowhead.
4. Move one of the shapes — the connector should update automatically.

### 6. Selection and multi-select

1. Click on a blank area to deselect all shapes.
2. Click the Rectangle — it shows selection handles (dashed blue border).
3. Hold Shift and click the Ellipse — both shapes are now selected.
4. Expected: Selection handles appear on both shapes.
5. Press ⌘A (or Ctrl+A) — all shapes and connectors should be selected.
6. Press Escape — all deselected.

### 7. Lasso selection

1. Click and drag over empty space to draw a lasso rectangle.
2. Any shapes fully within the lasso should become selected when you release the mouse.

### 8. Undo / Redo

1. Add three shapes to the canvas.
2. Press ⌘Z (Ctrl+Z) — the last shape disappears.
3. Press ⌘Z again — the second-to-last shape disappears.
4. Press ⌘⇧Z (Ctrl+Y) — the shape reappears.
5. Expected: Undo/Redo buttons in the toolbar also reflect the state.

### 9. Properties panel

1. Select a shape — the right panel shows Geometry (X, Y, W, H) and Style (fill color, stroke, opacity, font size).
2. Change the fill color — the shape on canvas updates immediately.
3. Change the stroke width — the shape border updates.
4. Select a connector — the right panel shows connector type, label field, end arrow picker.
5. Change the connector type to "Orthogonal" — the connector path changes to right angles.

### 10. Shape library categories (Phase 2)

1. In the shape panel, expand "Flowchart" and add a "Decision" shape (diamond).
2. Expand "Network" and add a "Server" shape.
3. Expand "UML" and add a "Class" shape.
4. All shapes should render on the canvas with their distinct shapes.

### 11. Arrange tools

1. Select two shapes.
2. Click the "Align left" button in the toolbar — both shapes align their left edges.
3. Click "Align center (horizontal)" — shapes center horizontally.
4. With one shape selected, click "Bring to front" — the shape moves to the top of the layer order.

### 12. Page management

1. Click the "+" button next to "Page 1" at the bottom of the canvas.
2. Expected: "Page 2" tab is created and you switch to the blank new page.
3. Add a shape to Page 2.
4. Click "Page 1" tab — you switch back and see Page 1's shapes.
5. Double-click "Page 2" tab and rename it to "Architecture".

### 13. Zoom and pan

1. Use the scroll wheel (or pinch on trackpad) to zoom in and out.
2. Expected: The canvas zooms around the mouse cursor position.
3. The zoom controls in the bottom-right show the current percentage.
4. Press the "H" key to switch to Pan mode (cursor changes to hand).
5. Click and drag to pan the canvas.
6. Click "Reset" in the zoom controls to return to 100% view.

### 14. Autosave

1. Make changes to the diagram (add/move shapes).
2. Wait 2-3 seconds.
3. Expected: Changes are automatically saved (no explicit save button press needed, though the Save button also works).
4. Refresh the page and navigate back to the editor — changes should be persisted.

### 15. Save with title rename

1. Click the diagram title in the toolbar ("Untitled diagram").
2. Type a new name and press Enter.
3. Navigate back to `/diagrams` — the diagram appears with the new title.

### 16. Comments panel (Phase 3)

1. In the editor, click the speech bubble icon in the toolbar to open the Comments panel.
2. Type a comment in the compose box and click "Comment".
3. Expected: The comment appears in the thread with your user ID and timestamp.
4. Click "Reply" on the comment, type a reply and submit.
5. Expected: The reply appears indented under the original comment.
6. Click "Resolve" — the comment thread is grayed out (resolved state).
7. Click "Reopen" — the thread reverts to normal.
8. Click the trash icon to delete a comment.

### 17. Real-time collaboration (Phase 3)

1. Open the same diagram in two different browser windows (or a private window).
2. In Window 1, add a shape.
3. Expected: The shape appears in Window 2 (via y-websocket protocol, may take a few seconds depending on event loop).
4. Move your mouse around Window 1's canvas.
5. Expected: A colored cursor labeled with your username appears in Window 2.
6. The presence bar in Window 2's toolbar should show an avatar for Window 1's user.

### 18. FAB creates diagram

1. Click the "+" FAB button in the bottom-right corner of any page.
2. Expected: "Diagram" option appears in the FAB menu.
3. Click "Diagram" — you are taken to a new blank diagram in the editor.

### Edge Cases

- **Empty title:** Try creating a diagram with an empty title via the API directly — should return 400.
- **Zoom limits:** Try zooming out past 5% or in past 800% — the canvas should clamp at those limits.
- **Delete key:** Select shapes and press Delete/Backspace — shapes should be removed along with any connected connectors.
- **Duplicate:** Select shapes, press ⌘D — duplicates appear offset by 20px.

### Feature Disabled Check

1. Set `FEATURE_DIAGRAMS_APP=false` (or remove the env var) and restart the backend.
2. All `/api/v1/diagrams*` endpoints should return 404.
3. Navigate to `/diagrams` in the frontend — shows "Diagrams coming soon" or disabled state.
4. The FAB "Diagram" option still appears (frontend is feature-flagged via `flags.diagramsApp`), but creating a diagram shows an error toast.

## Cleanup

Delete this VERIFY-diagramming-app.md after the `FEATURE_DIAGRAMS_APP` flag is removed and the feature is proven stable.
