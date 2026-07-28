# Plan: Switch Notes list-fetching to generic Drive API (`type=note`)

Branch: `refactor/notes-list-via-drive-api`

## What is changing and why

The Notes app currently lists notes via the dedicated `GET /api/v1/notes` endpoint
(`notesApi.listNotes()` from `@neutrino/api-notes`). PR #64 (already merged to `main`)
added a `DriveFileType::Note` variant on the backend and a matching `'note'` literal to
the frontend `DriveFileType` union (`@neutrino/api-drive`'s `FileListQuery.type`), so the
generic Drive listing endpoint (`GET /api/v1/drive?type=note`) can now return exactly the
same set of files (matched by MIME type `application/x-neutrino-note`).

This change swaps the **read/list** path in the two places that call `notesApi.listNotes()`
for pure listing purposes, over to `filesystemApi.getRootContents({ type: 'note', ... })`.
It does **not** touch any note content operations (create/get/save/delete/backlinks) —
those keep using `@neutrino/api-notes` because the generic Drive `FileItem` type carries
no note content (title+body), only filesystem metadata.

Backend requires no changes — already fully supports this.

## Layers affected

- **Frontend only.** Two route files under `web/apps/web/src/app/(apps)/notes/`:
  - `page.tsx` — notes grid/list page
  - `editor/page.tsx` — note editor (uses the list purely for wiki-link `[[...]]`
    autocomplete + title matching)
- No backend, no design/CSS changes.
- Tests: existing Vitest unit tests for these two pages (if any) need their mocks updated;
  e2e regression check only (no new e2e tests — behavior must not visibly change).

## Exact changes

### 1. `notes/page.tsx`

- Replace the query:
  ```ts
  const { data, isLoading, isError } = useQuery({
    queryKey: ['notes'],                              // unchanged — keeps existing
                                                        // invalidateQueries(['notes']) calls
                                                        // after create/rename/delete working
    queryFn: () => filesystemApi.getRootContents({ type: 'note', orderBy: 'createdAt', direction: 'desc' }),
  });
  ```
- `notes` becomes `data?.files ?? []` (was `data?.notes ?? []`).
- `noteToGridItem(note: NoteMetaResponse)` → `noteToGridItem(note: FileItem)`, reads
  `note.name` instead of `note.title`.
- Add `import { filesystemApi, type FileItem } from '@neutrino/api-drive';` (direct package
  import per `web/CLAUDE.md` convention for new code — not through the `@/lib/api` barrel).
- Drop the now-unused `type NoteMetaResponse` import from `@/lib/api` — `notesApi` itself
  stays imported and used for createNote/renameMutation(getNote+saveNote)/deleteMutation.
- Grepped the whole file: `noteToGridItem` is the **only** place that reads `.title` off a
  note object. Everything downstream (`NoteContextMenu`, the rename dialog, `handleMenuOpen`)
  already reads `item.name`/local `title` state that was populated from `GridItem.name` at
  the call site — no further changes needed there.

**Ordering/pagination — deliberate choice to preserve current behavior, not fix it:**
I traced the backend (read-only, via a research pass) and found the two endpoints have
different defaults:
- `GET /api/v1/notes` → hardcoded `ORDER BY created_at DESC`, hardcoded `LIMIT 200`
  (`src/shared/drive_client.rs:90-96`, not client-configurable at all today).
- `GET /api/v1/drive?type=note` (typed listing) → defaults to `ORDER BY name ASC` if no
  `orderBy`/`direction` passed, and is **unbounded** (no SQL `LIMIT`) unless the client
  passes an explicit `limit`.

To reproduce the current effective order (newest-first) I'll pass
`orderBy: 'createdAt', direction: 'desc'` explicitly. For the count: I will **not** pass an
explicit `limit`, which lets `@neutrino/api-drive`'s client-side default (`limit = 200`,
in `filesystemApi.getRootContents`) apply — this reproduces the same 200-note cap the old
endpoint had, so behavior is unchanged either way (confirmed via backend trace: omitting
`limit` client-side still sends `limit=200` to the server, same cap as before).

Separately confirmed: `FileGrid` (`@neutrino/ui`) does not sort `items` itself — the
`sortBy`/`sortDir` state and `onSortChange` in `page.tsx` are pre-existing UI-only wiring
that was already not connected to the actual fetch (the old `notesApi.listNotes()` took no
sort params either, and `queryKey: ['notes']` doesn't include `sortBy`/`sortDir`). That's a
pre-existing gap in the notes page, out of scope for this swap — I'm preserving it exactly
as-is, not fixing it.

### 2. `notes/editor/page.tsx`

- Replace the `allNotesData` query the same way:
  ```ts
  const { data: allNotesData } = useQuery({
    queryKey: ['notes'],
    queryFn: () => filesystemApi.getRootContents({ type: 'note' }),
  });
  ```
- **Adapter at the boundary, not a deep type-plumbing change.** `allNotes` currently flows
  as `NoteMetaResponse[]` ({ id, title, folderId, createdAt, updatedAt }) three levels deep:
  `editor/page.tsx` → `BlockEditor` → `BlockRow` → `TableBlock` / `blockEditorHelpers.renderInline`
  / `insertWikiLink`. Both `BlockRow.tsx` and `blockEditorHelpers.ts` read `.title` off each
  note for wiki-link autocomplete matching and rendering.
  Rather than propagating the Drive `FileItem` shape (which carries irrelevant fields like
  `sizeBytes`, `mimeType`, `isStarred`) into that editor-internal component tree, I'll map
  the result to the existing `NoteMetaResponse` shape right where it's consumed:
  ```ts
  const allNotes: NoteMetaResponse[] = (allNotesData?.files ?? []).map((f) => ({
    id: f.id,
    title: f.name,
    folderId: f.folderId,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }));
  ```
  This satisfies the actual requirement (read `.name` from the new source, use it as the
  note's display/match title) while leaving `BlockEditor.tsx`, `BlockRow.tsx`,
  `TableBlock.tsx`, and `blockEditorHelpers.ts` — and their `NoteMetaResponse`-typed props —
  completely untouched. Smaller diff, zero risk to the wiki-link/autocomplete/table-cell
  rendering logic, and `NoteMetaResponse` remains the correct domain type for "a note's
  title," which those editor-internal files are legitimately concerned with regardless of
  which backend endpoint supplied the list.
  I'm flagging this as a deliberate deviation from a literal reading of "adjust the
  matching logic to read `.name` instead of `.title` on each item" — happy to instead
  thread `FileItem`/`.name` all the way through those 4 files if preferred, but the adapter
  gets identical visible behavior with a much smaller blast radius.

### 3. Tests

- No existing Vitest test files were found covering `notes/page.tsx` or
  `notes/editor/page.tsx` (searched `web/apps/web/src/__tests__/` — only note-adjacent hit
  is `docs/FootnoteExtension.test.ts`, unrelated). So there's nothing to "update" for these
  two files; test-writer will be asked to add coverage instead:
  - `notes/page.tsx`: mock `filesystemApi.getRootContents`, assert it's called with
    `{ type: 'note', orderBy: 'createdAt', direction: 'desc' }`, assert grid items render
    from `.name`.
  - `notes/editor/page.tsx`: mock `filesystemApi.getRootContents` with `{ type: 'note' }`,
    verify wiki-link autocomplete/backlink matching still works against `.name`-derived
    titles.
  Since this is a refactor of already-shipped behavior (not new functionality), I'm running
  this as an additive test pass, not strict TDD red/green — there's no existing red-phase
  test suite for these files to fail first.

### 4. e2e regression check

- Run existing notes e2e spec(s) under `e2e/tests/notes/` after a fresh Docker build, to
  confirm no visible regression (list still renders, create/rename/delete/backlinks/wiki-links
  all still work).

### 5. Lint / type-check

- `pnpm lint` / `pnpm type-check` for the touched app (`apps/web`) and touched packages.

## Known risks / edge cases

- **Ordering/limit divergence** between the two backend endpoints (detailed above) —
  mitigated by explicit `orderBy`/`direction` params; limit left to the client default
  (200) to match old behavior exactly.
- **`FileItem` has no `title` field** — every read of a note's display name downstream of
  the swapped query must use `.name`. Verified via grep that `page.tsx` has exactly one
  such call site (`noteToGridItem`); `editor/page.tsx`'s adapter isolates the rest.
- **Do not touch** `settings/page.tsx`'s reindex job (still calls `notesApi.listNotes()`) —
  out of scope, confirmed left alone.
- **Do not touch** `migrations/00095_oauth__2026-06-13-000001_create_oauth_clients/up.sql`
  — unrelated uncommitted change already in the working tree, being decided separately by
  the user. Will not stage/commit/revert it; will exclude it explicitly from any `git add`.
- **Do not touch** any `notesApi.createNote/getNote/saveNote/deleteNote/getBacklinks` call
  site — those remain content operations via `@neutrino/api-notes`.

## Acceptance criteria

- `notes/page.tsx` and `notes/editor/page.tsx` no longer call `notesApi.listNotes()`.
- Both call `filesystemApi.getRootContents({ type: 'note', ... })` from `@neutrino/api-drive`
  (direct import, not via `@/lib/api` barrel).
- Notes grid renders identical content/order to before (same 200-cap, newest-first).
- Wiki-link autocomplete, rendering, and table-cell link rendering in the note editor are
  unaffected.
- `settings/page.tsx` reindex job untouched; all `notesApi` content-mutation call sites
  untouched.
- `pnpm lint` and `pnpm type-check` pass for `apps/web`.
- Existing/new Vitest tests pass; notes e2e spec(s) pass against a freshly built Docker image.
- The stray `migrations/00095.../up.sql` modification remains untouched and uncommitted.

## Specialists needed

- `frontend-developer` — implement the two call-site swaps described above.
- `test-writer` — add/update Vitest coverage for the two pages' list-fetching.
- No `rust-developer` (backend already supports this) and no `ui-designer` (no visual change).
