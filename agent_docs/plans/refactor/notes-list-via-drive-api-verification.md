# Manual Verification: Notes list-fetching via Drive API

This change swaps the Notes app's list-fetching (grid page + editor's wiki-link note
index) from the dedicated `GET /api/v1/notes` endpoint to the generic
`GET /api/v1/drive?type=note` endpoint. It is a pure data-source swap — nothing here
should look or behave differently to a user. The checklist below is about confirming
the absence of regressions, not new functionality.

## Prerequisites

- [ ] A test account with at least 3-4 existing notes, at least one of which has a
      distinctive title for easy visual matching (e.g. "Grocery List").
- [ ] At least one note whose title contains a word you can search/autocomplete on in
      another note via `[[`.
- [ ] Browser DevTools Network tab open (to confirm the actual request URL used).

## Steps to Verify

### Happy path

1. Open the Notes app (`/notes`). Confirm the grid/list renders all your existing
   notes, each showing the correct title and "last modified" date — visually
   identical to before this change.
2. In DevTools Network tab, confirm the listing request is now
   `GET /api/v1/drive?type=note&orderBy=createdAt&direction=desc&limit=...&offset=0`
   (or similar drive-shaped query string) — NOT `GET /api/v1/notes`.
3. Click "New Note". Confirm it creates successfully and navigates into the editor.
4. Rename a note via the "..." context menu → Rename. Confirm the rename dialog
   pre-fills the current title, and after submitting, the notes grid reflects the new
   title (this exercises `notesApi.getNote`/`saveNote`, untouched by this change, plus
   the `['notes']` query-key invalidation that re-fetches the now-Drive-backed list).
5. Delete a note via "..." → "Move to trash". Confirm it disappears from the grid.
6. Open a note in the editor. Type `[[` followed by a few letters of another existing
   note's title. Confirm the autocomplete dropdown shows matching note titles and
   inserting one creates a working wiki-link (click it to navigate to that note).
7. Confirm the "Linked from" backlinks panel still appears correctly on a note that is
   linked to from another note (this uses `notesApi.getBacklinks`, untouched).
8. Copy a note's link via the context menu, confirm it still points to
   `/notes/editor?id=<id>` and opens the correct note.

### Edge cases

1. **Empty state**: as a fresh account (or after deleting all notes), confirm the
   "No notes yet" empty state still renders with a working "New Note" button.
2. **Preview**: use "..." → Preview on a note, confirm the preview modal still opens
   with correct content.
3. **Wiki-link to a non-existent title**: type `[[Some Nonexistent Title]]` in the
   editor and confirm it renders as a broken-link style (not a crash), matching prior
   behavior.
4. **Large note count**: if feasible, test with a user who has >50 notes — confirm the
   grid still loads all of them (both the old and new endpoints cap around ~200, so
   this isn't a regression risk, but worth a sanity check).
5. **Settings → rebuild search index**: separately confirm the Settings page's
   "Rebuild search index" action (unrelated code path, still uses `notesApi.listNotes()`
   deliberately, out of scope for this change) still works and still indexes notes
   correctly — this is a regression check that we did NOT accidentally touch that path.

## Expected Results

- No visual or behavioral difference anywhere in the Notes app.
- Network tab confirms the listing request now hits `/api/v1/drive?type=note` instead
  of `/api/v1/notes`.
- All CRUD operations (create/rename/delete), previews, backlinks, and wiki-link
  autocomplete continue to work exactly as before.
- Settings page's search reindex (a separate, intentionally-untouched code path) is
  unaffected.
