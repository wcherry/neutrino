# E2E Coverage Gaps

This document maps the current Playwright e2e suite against the visible Neutrino app surface so future agents can add robust browser coverage where it is missing.

## Current E2E Coverage

Existing specs live under `e2e/tests/` and currently cover:

- Auth: register and login.
- Navigation: sidebar smoke coverage.
- Drive: file lifecycle and shared end-to-end encryption behavior.
- Docs: lifecycle, encryption, PDF export, spell check, grammar check, and keyboard shortcuts.
- Sheets: lifecycle, autosave, encryption, formulas, tabs, charts, XLSX export, embeds, cross-sheet references, absolute references, and keyboard shortcuts.
- Slides: lifecycle and encryption.
- Photos: encryption and thumbnail generation.
- Notes: note lifecycle.
- Search: search flow.

## Highest-Priority Missing Areas

These areas have product routes or substantial UI/backend modules but no dedicated e2e specs.

### Calendar

Add `e2e/tests/calendar/` coverage for:

- Event lifecycle: create, edit, delete, and reopen events across month, week, and agenda views.
- Event details: attendees, reminders, notes/description, location, time zones, and recurring-like edge cases if supported.
- Task lists: create task lists, create tasks, drag reorder, move between lists, complete/uncomplete, and persistence after reload.
- Reminders sidebar: create, edit, dismiss/complete, and verify ordering.
- Drive file picker attachments: attach a Drive file to an event, reopen event detail, and verify link persistence.
- Calendar settings and OAuth connection states: disconnected state, provider start flow, callback error state, and non-secret UI assertions.

Suggested files:

- `e2e/tests/calendar/event-lifecycle.spec.ts`
- `e2e/tests/calendar/tasks.spec.ts`
- `e2e/tests/calendar/reminders.spec.ts`
- `e2e/tests/calendar/attachments.spec.ts`
- `e2e/tests/calendar/settings.spec.ts`

### Diagrams

Add `e2e/tests/diagrams/` coverage for:

- Diagram lifecycle from Drive or the diagrams landing page: create, rename, open, autosave, reload, and delete.
- Canvas editing: add shapes, move/resize, connect shapes, edit text, undo/redo, and verify persistence.
- Multi-page diagrams: add page, rename page, switch pages, delete page, and reload.
- Import/export dialogs: import supported formats and export PNG/SVG/draw.io where implemented.
- Shape libraries: enable/disable libraries and insert at least one third-party/library shape.
- Collaboration UI: comments and presence smoke tests where the local test stack can support multi-user sessions.
- Docs/slides embeds: insert a diagram into another editor and verify the embedded preview survives reload.

Suggested files:

- `e2e/tests/diagrams/diagram-lifecycle.spec.ts`
- `e2e/tests/diagrams/canvas-editing.spec.ts`
- `e2e/tests/diagrams/import-export.spec.ts`
- `e2e/tests/diagrams/embeds.spec.ts`

### Drawing

Add `e2e/tests/drawing/` coverage for:

- Drawing lifecycle: create, open editor, autosave, reload, rename, and delete.
- Canvas tools: select, pen/shape/text tools, style changes, layer ordering, and undo/redo.
- Export flow: open export dialog, export at least one format, and assert the download.
- Persistence: verify drawn content is visible after reload and after returning from Drive.

Suggested files:

- `e2e/tests/drawing/drawing-lifecycle.spec.ts`
- `e2e/tests/drawing/canvas-tools.spec.ts`
- `e2e/tests/drawing/export.spec.ts`

### Admin

Add `e2e/tests/admin/` coverage for:

- Admin page access control: normal users cannot access admin-only routes, admin users can.
- Services/processes dashboards: visible data loads without client errors and refresh actions work.
- Feature flags: view flags, toggle a non-destructive test flag, reload, and verify persistence.
- Audit/compliance/security pages or panels as they become route-visible.

Suggested files:

- `e2e/tests/admin/access-control.spec.ts`
- `e2e/tests/admin/dashboard.spec.ts`
- `e2e/tests/admin/feature-flags.spec.ts`

### Settings, Profile, and User Profiles

Add e2e coverage for:

- Settings page smoke coverage and editable preferences.
- Theme switching persistence across reload and login.
- Profile page fields, avatar/display name flows if implemented, and validation.
- User profile route visibility and access behavior.

Suggested files:

- `e2e/tests/settings/settings.spec.ts`
- `e2e/tests/profile/profile.spec.ts`

## Partially Covered Areas Needing More Robustness

### Drive

Current drive specs cover file lifecycle and encryption, but the Drive surface is broader.

Add coverage for:

- Folder lifecycle, nested folders, move/copy, breadcrumbs, and folder context menus.
- Upload zone behavior, including drag/drop or file chooser upload and failed upload messaging.
- Preview modal for supported file types and close/reopen behavior.
- Share dialog and permissions: invite another user, change role, revoke access, and verify second-user access.
- Shared, recent, starred, team/shared drives, and trash pages.
- Restore from trash and permanent delete flows.
- File info panel metadata, activity, versions, and comments if exposed.
- Tags, priority, access requests, notifications, and shortcuts where UI exists.

Suggested files:

- `e2e/tests/drive/folders.spec.ts`
- `e2e/tests/drive/upload-preview.spec.ts`
- `e2e/tests/drive/sharing-permissions.spec.ts`
- `e2e/tests/drive/trash.spec.ts`
- `e2e/tests/drive/collections.spec.ts`

### Docs

Docs has good baseline coverage, but many advanced editor features only have unit/component tests.

Add e2e coverage for:

- Templates page and create-from-template flow.
- Import/export formats beyond PDF where stable: DOCX, HTML, TXT.
- Header/footer, page setup, themes, watermarks, paragraph styles, lists, tables, advanced image settings, and footnotes.
- Find/replace, outline navigation, table of contents, cross references, section breaks, and columns.
- Track changes and document compare flows.
- Comments and version history: add comment, resolve comment, save named version, restore/preview.
- Presence/collaboration with two browser contexts if the test fixture supports multiple users.
- Diagram and sheet embeds in docs.

Suggested files:

- `e2e/tests/docs/doc-templates.spec.ts`
- `e2e/tests/docs/doc-advanced-formatting.spec.ts`
- `e2e/tests/docs/doc-collaboration.spec.ts`
- `e2e/tests/docs/doc-version-history.spec.ts`
- `e2e/tests/docs/doc-embeds.spec.ts`

### Sheets

Sheets has the strongest e2e coverage today. Remaining gaps are mostly advanced spreadsheet workflows.

Add coverage for:

- Conditional formatting creation/edit/delete and reload persistence.
- Custom number/date formats and toolbar formatting controls.
- Find/replace and filters.
- Clipboard flows: paste tabular data, copy ranges, cut/paste formulas, and date formatting edge cases.
- Row/column insert/delete/resize, fill handle if implemented, and context menus.
- Named ranges and formula references to named ranges.
- Sheet sharing/presence if exposed.
- Chart editing after creation: change chart type, labels, colors, range, and export.

Suggested files:

- `e2e/tests/sheets/sheet-conditional-formatting.spec.ts`
- `e2e/tests/sheets/sheet-formatting.spec.ts`
- `e2e/tests/sheets/sheet-find-filter.spec.ts`
- `e2e/tests/sheets/sheet-clipboard.spec.ts`
- `e2e/tests/sheets/sheet-named-ranges.spec.ts`

### Slides

Slides currently has lifecycle and encryption coverage only.

Add coverage for:

- Slide editor basics: add/delete/reorder slides, edit text, change layout/theme, and reload.
- Insert image, sheet, and diagram dialogs.
- Presenter view and slide mirror route.
- AI panel smoke test with mocked or deterministic responses where possible.
- Export/download flows if exposed.
- Autosave warning and recovery behavior.

Suggested files:

- `e2e/tests/slides/slide-editor.spec.ts`
- `e2e/tests/slides/slide-embeds.spec.ts`
- `e2e/tests/slides/slide-presenter.spec.ts`
- `e2e/tests/slides/slide-export.spec.ts`

### Photos

Current coverage verifies encryption and thumbnail behavior, but the Photos app has editing and organization surfaces.

Add coverage for:

- Photo upload/import through the UI and persistence in the grid.
- Photo detail/info panel metadata and download/open behavior.
- Albums, smart suggestions, faces/persons, and person timeline flows.
- Map view and location metadata where deterministic fixtures are possible.
- Photo editor: crop/rotate/adjustments, save copy or overwrite behavior, and reload.
- AI/suggestions panels with mocked or deterministic test data.

Suggested files:

- `e2e/tests/photos/photo-upload.spec.ts`
- `e2e/tests/photos/photo-albums.spec.ts`
- `e2e/tests/photos/photo-faces.spec.ts`
- `e2e/tests/photos/photo-map.spec.ts`
- `e2e/tests/photos/photo-editor.spec.ts`

### Notes

Current coverage has a lifecycle smoke test only.

Add coverage for:

- Block editor interactions: headings, checklists, tables, links, code blocks, drag/reorder if implemented.
- Note linking/backlinks and persistence.
- Search integration from notes content.
- Autosave and offline/error states if surfaced.

Suggested files:

- `e2e/tests/notes/block-editor.spec.ts`
- `e2e/tests/notes/note-links.spec.ts`
- `e2e/tests/notes/note-search.spec.ts`

### Search

Current search coverage should be expanded across indexed content types.

Add coverage for:

- Search results from docs, sheets, slides, notes, photos metadata, and Drive file names.
- Empty, no-results, typo, and special-character queries.
- Result navigation opens the correct app/editor.
- Permission filtering: results hidden after access is revoked.
- Search index freshness after rename, edit, delete, and restore.

Suggested files:

- `e2e/tests/search/cross-app-search.spec.ts`
- `e2e/tests/search/permissions.spec.ts`
- `e2e/tests/search/index-freshness.spec.ts`

### Auth and OAuth

Current auth coverage covers register and login.

Add coverage for:

- Logout and session persistence across reload/new browser context.
- Invalid credentials, duplicate registration, password validation, and form validation messages.
- TOTP/2FA flows if enabled in the test stack.
- OAuth authorization-code flows and callback errors where deterministic local providers or mocks are available.
- Access revocation behavior and expired/invalid token handling where visible from the UI.

Suggested files:

- `e2e/tests/auth/logout-session.spec.ts`
- `e2e/tests/auth/validation.spec.ts`
- `e2e/tests/auth/totp.spec.ts`
- `e2e/tests/auth/oauth.spec.ts`

## Cross-Cutting Robustness Gaps

Add shared coverage patterns that cut across multiple apps:

- Multi-user permission tests with two browser contexts for sharing, access revocation, comments, and collaboration presence.
- Autosave/reload persistence tests for every editor app.
- Download assertions for every export feature.
- Dark mode/theme persistence across major routes.
- Mobile viewport smoke tests for navigation and read-only/detail views.
- Accessibility smoke checks for major dialogs and keyboard-only flows.
- Error state tests for failed API calls, empty states, and loading states.
- Encryption assertions for every encrypted file type, not just the first-generation editors.

## Recommended Execution Order

1. Calendar, diagrams, drawing, admin, settings/profile: these are whole areas with no dedicated e2e coverage.
2. Drive sharing/trash/upload and slides editor/presenter: high-value user flows with only partial coverage.
3. Docs collaboration/versioning and photos organization/editor: broad UI surfaces backed by existing modules.
4. Sheets advanced workflows and search/auth edge cases: improve confidence in already-covered domains.
5. Cross-cutting mobile, accessibility, error, and multi-user hardening.

## Agent Checklist For New E2E Specs

- Place specs under `e2e/tests/<area>/`.
- Import `test` and `expect` from `../../fixtures/base`.
- Prefer user-visible assertions plus targeted API/state assertions where helpful.
- Use deterministic fixture content and unique names per test.
- Verify persistence by reloading or reopening the app after mutating data.
- Assert downloads for export flows instead of only clicking the export button.
- For permission/collaboration tests, use separate browser contexts and clearly named users.
- Keep each spec focused on one user journey so failures point to a specific product area.
