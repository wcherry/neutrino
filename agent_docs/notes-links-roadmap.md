# Roadmap: Notes → Links Service + Unified File Sync

**Date:** 2026-08-08
**Status:** Ready for implementation
**Design doc:** [`notes-redesign.md`](./notes-redesign.md) — read that first for full rationale on every decision below. This document is the execution plan; it does not re-argue decisions, only sequences them.

## What this is

Three separable pieces of work, in dependency order:

1. **Links Service** — replace the notes module's CRUD APIs with a generic, file-type-agnostic backlinks service usable by notes, docs, sheets, slides, etc.
2. **Shared File Events** — generalize the existing `PresenceRoom` primitive (already reused ad-hoc by notes and sheets) into one real drive-wide WebSocket endpoint, replacing three duplicate per-app routes.
3. **Notes Frontend Migration** — move the notes editor off the old notes CRUD API onto drive APIs + the new links service + the new shared socket.

Each piece can be a separate PR/session. **Do them in this order** — (3) depends on (1) and (2) existing.

---

## Ground truth (verified against the actual codebase, not assumed)

Read this before touching anything — it corrects two claims that were floated during design and are **not true of this codebase**:

- **There is no "parent app" / owner-client pattern anywhere in this repo.** Docs and Sheets do not designate one client as an owner that others relay through. Do not build one.
- **There is no shared drive-wide WebSocket today.** Notes, Sheets, and Slides each mount their *own* route (`/api/v1/notes/{id}/ws`, `/api/v1/sheets/{id}/ws`, `/api/v1/slides/{id}/ws`), but all three are thin wrappers around the same generic primitive: `src/shared/presence_room.rs` (`DashMap<String, Arc<PresenceRoom>>` keyed by file id, broadcast channel, signal-only — no content travels over it). Building phase 2 below means collapsing three routes into one; it is not "wiring into something that already exists as a shared service."
- **Docs uses real CRDT collaboration** (Yjs, `src/docs/collab/api.rs`), a live `yrs::Doc` per room. This is a genuinely different mechanism from `PresenceRoom` and must **not** be folded into the shared file-events work. Leave Docs' socket alone.
- **`notificationsApi` / the notifications WebSocket** (`web/packages/api-drive/src/client.ts`) is unrelated — it's the sharing/comments/suggestions feed, not a file-content-changed signal. Don't reuse it for this.

If any of these turn out to be stale by the time you start, verify against the code before proceeding — don't trust this doc over `grep`.

---

## Phase 1: Links Service (Backend + new frontend package)

**Goal:** A generic backlinks system any file type can use, decoupled from notes.

### Backend

1. **Rename schema:** `note_links` → `file_links`
   - Migration: `ALTER TABLE note_links RENAME TO file_links` (SQLite — confirm rename semantics for indexes/constraints don't need separate handling)
   - Columns: `source_file_id`, `target_file_id`, `created_at` (renamed from `source_note_id`/`target_note_id`, same shape otherwise)

2. **New module `src/links/`** (parallel structure to `src/notes/`, not nested under it):
   - `model.rs` — `FileLinkRecord`, `NewFileLinkRecord` (renamed from notes' equivalents)
   - `repository.rs` — port from `src/notes/repository.rs`:
     - `get_backlink_source_ids(target_file_id) -> Vec<String>` (renamed from `get_backlink_source_ids`, same logic)
     - `batch_update_links(source_file_id, added: &[String], removed: &[String])` — **new**, replaces `replace_links`. Insert `added`, delete `removed`, in one transaction. Do NOT delete-all-then-reinsert (that was `replace_links`'s approach and is what add/remove lists are meant to avoid — see design doc Decision 3 in the "Frontend Extracts Links" section for why).
     - `delete_links_for_file(file_id)` (renamed from `delete_links_for_note`, same logic — deletes rows where file_id is source OR target)
   - `dto.rs`:
     ```rust
     pub struct UpdateLinksRequest {
         pub linked_titles: Option<Vec<String>>,
         // linked_ids / linked_ranges: NOT in scope for this phase — types
         // exist in the request shape for forward-compatibility but only
         // linked_titles needs a working resolver right now (notes is the
         // only caller). Reject requests that set the others with 400.
     }
     pub struct FileLinkItem {
         pub id: String,
         pub title: String,
         pub file_type: String,  // "note" | "doc" | "sheet" | ... — read from drive's mime_type, mapped to a short label
     }
     pub struct BacklinksResponse {
         pub backlinks: Vec<FileLinkItem>,
     }
     ```
   - `service.rs`:
     - `get_backlinks(user, file_id) -> BacklinksResponse` — port from `NotesService::get_backlinks`, generalized:
       - Fetch file via `DriveClient::get_file` (already generic, not notes-specific)
       - 404 if deleted or user lacks read access (see Phase 1 permission rule below)
       - For each backlink source id, re-check deleted + read access before including it
     - `update_links(user, file_id, req: UpdateLinksRequest) -> BacklinksResponse` — **new**:
       1. Fetch `file_id` via drive; require `your_role` in `["owner", "editor"]` else 403
       2. If deleted, 404
       3. Resolve `linked_titles` → file IDs: list files the user can read whose title case-insensitively matches (drive's `list_files` is already generic — do not filter by notes' MIME type here, search across all types)
       4. Silently drop any title that doesn't resolve, resolves to a deleted file, or resolves to a file the user can't read — **no error for these**, this is normal (see design doc Decision 4/5 — permission and deletion both collapse to "acts like it doesn't exist")
       5. Exclude self-links (`id == file_id`)
       6. Diff resolved target ids against `repo.get_backlink_source_ids`... no — against the **current outgoing links from `file_id`**, which needs a new repo method: `get_link_target_ids(source_file_id) -> Vec<String>` (symmetric to `get_backlink_source_ids`, filters on `source_file_id` instead of `target_file_id`)
       7. Compute `added`/`removed` as set differences
       8. `repo.batch_update_links(file_id, &added, &removed)`
       9. Return `get_backlinks(user, file_id)` — response shows *incoming* links (unchanged contract), not what was just resolved as outgoing
   - `api.rs` — Axum handlers:
     - `GET /api/v1/links/{file_id}/backlinks` → `get_backlinks`
     - `PATCH /api/v1/links/{file_id}` → `update_links`
   - Wire into `main.rs` router; do not remove old `/api/v1/notes/*` routes yet (that's Phase 3 cleanup)

3. **Move `parse_wiki_links` out of `src/notes/service.rs`.** It becomes dead code on the backend once notes stops calling it server-side (frontend takes over parsing per the design doc). Delete it in this phase along with its unit tests — don't leave it as unreachable code. If frontend parsing (Phase 3) isn't landed yet when this phase ships, keep it temporarily and delete in Phase 3 instead; sequencing is your call, just don't ship a permanent duplicate.

4. **Tests:**
   - Port the 4 existing `parse_wiki_links` unit tests — they move to wherever the frontend equivalent lives (Phase 1 frontend, below), not backend, since parsing is frontend-owned now
   - New backend tests for `update_links`: added/removed diff correctness, self-link exclusion, case-insensitive title match, silent-drop on inaccessible/deleted target, 403 on non-editor, 404 on deleted source

### Frontend

5. **New package `@neutrino/api-links`** (`web/packages/api-links/`), modeled on `web/packages/api-notes/src/index.ts`'s structure:
   ```typescript
   export const linksApi = {
     async getBacklinks(fileId: string): Promise<BacklinksResponse> { ... },
     async updateLinks(fileId: string, req: UpdateLinksRequest): Promise<BacklinksResponse> { ... },
   }
   export interface UpdateLinksRequest { linkedTitles?: string[] }
   export interface FileLinkItem { id: string; title: string; fileType: string }
   export interface BacklinksResponse { backlinks: FileLinkItem[] }
   ```
   Add to `apps/web/src/lib/api.ts` re-exports per the `web/CLAUDE.md` API-client convention.

6. **New package `@neutrino/markdown`** (`web/packages/markdown/`) — extract wiki-link parsing to shared frontend code:
   ```typescript
   export function extractWikiLinks(content: string): string[]
   ```
   Port logic from `src/notes/service.rs::parse_wiki_links` (byte-scanning `[[...]]`, trim, skip empty) — but the frontend already has `extractWikiLinkTitles` in `web/apps/web/src/app/(apps)/notes/editor/blockEditorHelpers.ts` operating on parsed `Block[]`, not raw content. **Check whether that existing function already covers this** before writing a new one — it may just need to move packages, not be reimplemented. Confirm with `grep -rn extractWikiLinkTitles web/` before starting.
   Port the 4 unit tests from `src/notes/service.rs` (`parse_wiki_links_basic`, `_empty`, `_trims_whitespace`, `_skips_empty_brackets`) to this package, adapted to whichever function ends up here.

**Acceptance for Phase 1:** `PATCH /api/v1/links/{fileId}` and `GET /api/v1/links/{fileId}/backlinks` work end-to-end against notes' existing MIME type via curl/integration test, without touching the notes editor UI yet. Old notes endpoints still work unchanged — this phase is additive only.

---

## Phase 2: Shared File Events (Backend + new frontend hook)

**Goal:** One WebSocket route for "this file changed," replacing three copies of the same thing.

### Backend

1. **New module `src/shared/file_events/`**:
   - `state.rs` — `DashMap<String, Arc<PresenceRoom>>`, same shape as `src/notes/presence/state.rs` / `src/sheets/presence/state.rs` today, just not duplicated per app
   - `api.rs` — `GET /api/v1/files/{id}/ws`: auth check via drive (`get_file`, require at least read), then delegate to `PresenceRoom` exactly as the existing per-app handlers do. Port directly from `src/notes/presence/api.rs` — the logic is already generic, it's only the route and the state map that were duplicated.
   - Reuse `src/shared/presence_room.rs` as-is — no changes needed there, it was already file-id-keyed and content-agnostic.

2. **Migrate notes onto it:** point the notes editor's socket calls at `/api/v1/files/{id}/ws` instead of `/api/v1/notes/{id}/ws`. Once confirmed working, delete `src/notes/presence/` entirely (module, route, state).

3. **Sheets migration is out of scope for this roadmap** but should be a near-identical follow-up once notes proves the shared endpoint works — flag it in the PR description rather than doing it inline, so this stays reviewable as one thing.

4. **Do not touch `src/docs/collab/`.** Confirmed separate mechanism (CRDT), confirmed out of scope per the ground-truth section above.

### Frontend

5. **New shared hook**, replacing `web/apps/web/src/hooks/useNoteSync.ts`'s notes-specific framing with a generic one (name it `useFileSync` or fold the rename into the existing file if that's less churn — reviewer's call):
   - Same signal-only contract `useNoteSync` already has: `{ clientId }` only, never content (this matters for E2EE — see `web/CLAUDE.md`'s "Notes live updates" section for why)
   - Same guard pattern already in the notes editor (`dirtyRef`/`savingRef`/`editSeqRef`/`appliedUpdatedAtRef` in `page.tsx`) should move into the hook if it isn't already there, so sheets/slides get the same correctness guarantees notes worked out, rather than re-deriving them per app later

**Acceptance for Phase 2:** Notes editor's live-update behavior (two tabs open, edit in one, other tab picks up the change) works identically to before, but over `/api/v1/files/{id}/ws` instead of `/api/v1/notes/{id}/ws`. `src/notes/presence/` is deleted, not just unused.

---

## Phase 3: Notes Frontend Migration

**Goal:** Notes editor, list page, creation, and takeout import stop calling notes CRUD entirely.

1. **Note editor** (`web/apps/web/src/app/(apps)/notes/editor/page.tsx`):
   - Replace `notesApi.getNote(noteId)` → `storageApi.getFileInfo(noteId)` (drive)
   - Replace `notesApi.saveNote(...)` → `storageApi.uploadFileContent(...)` (or whatever drive's autosave/content endpoint is called — confirm exact method name in `@neutrino/api-drive`) for content/title, **plus** `linksApi.updateLinks(noteId, { linkedTitles })` for the link graph, called after content save succeeds
   - Replace `notesApi.getBacklinks` → `linksApi.getBacklinks` (same call shape, different package)
   - Extract `linkedTitles` from plaintext **before** encryption (this logic already exists at `page.tsx:231`, just confirm it still runs pre-encryption after the refactor — this is not new, don't regress it)
   - Swap `useNoteSync` for the Phase 2 shared hook
   - Delete `notesApi.createNote`/`deleteNote`/`listNotes` call sites here if any remain

2. **Note list page** (`web/apps/web/src/app/(apps)/notes/page.tsx`): `notesApi.listNotes()` → `filesystemApi.getRootContents({ type: 'note' })`, `notesApi.deleteNote()` → drive's trash-file call, `notesApi.createNote()` → drive's create-file call with `application/x-neutrino-note` MIME type (constant currently in `src/notes/service.rs:18` — confirm where it should live post-refactor, likely stays a shared constant since drive needs it too)

3. **Takeout import** (`web/apps/web/src/lib/takeout/importKeep.ts`): same CRUD swap as above. This path also calls `notesApi.saveNote` for content — same replacement as the editor's save path, including the new `linksApi.updateLinks` call if imported notes contain wiki links (check `keep.ts`/`inlineHtml.ts` for whether Keep import already produces `[[links]]` — if not, this call can be skipped for import and only matters for post-import edits).

4. **Old `@neutrino/api-notes` package**: strip to just re-exporting `linksApi` under the old names, or delete entirely and update all three call sites above to import `@neutrino/api-links` directly — prefer deletion; keeping a compatibility shim for a codebase this size adds a layer nobody asked for one no other API package uses.

5. **Backend cleanup:** delete `src/notes/api.rs` CRUD handlers, `src/notes/service.rs` (now dead — `update_links`/`get_backlinks` live in `src/links/` per Phase 1), `src/notes/repository.rs` (superseded by `src/links/repository.rs`). Confirm nothing else references `src/notes::` before deleting — `grep -rn "notes::" src/`.

**Acceptance for Phase 3:** `src/notes/` directory is gone (or contains only genuinely notes-specific code, if any legitimately remains — check before assuming it fully disappears). Every notes user flow (create, edit, backlinks, live sync, delete, takeout import) works against drive + links + shared file-events, with zero remaining calls into old notes CRUD endpoints. `grep -rn "api/v1/notes" src/ web/` returns nothing except historical references in comments/docs.

---

## Explicitly out of scope (don't do these, even if they seem related)

- Migrating Sheets or Slides onto the Phase 2 shared socket — mention it as a follow-up, don't implement it
- Touching Docs' CRDT collaboration in any way
- `linkedIds` / `linkedRanges` request variants in the links API — the DTO shape should allow for them later (per design doc Decision 3's examples) but no resolver logic for either ships in this roadmap; notes only ever sends `linkedTitles`
- A `GET /api/v1/links/search` endpoint — mentioned as an idea in the design doc's Decision 2 but has no concrete caller in this roadmap; skip it
- Any admin/compliance/security features touching the links table

---

## Open items for whoever picks this up

- Confirm exact drive API method names (`storageApi.uploadFileContent` etc. are best-guess names from the design doc, not verified against `@neutrino/api-drive`'s actual exports — check `web/packages/api-drive/src/client.ts` before writing code)
- Confirm whether `extractWikiLinkTitles` (existing, `Block[]`-based) can be reused as-is for Phase 1's `@neutrino/markdown` package, or whether a raw-string version is also needed
- Decide feature-flag strategy for the Phase 3 cutover (the design doc's migration path mentions flags but doesn't specify one — per this user's standing preference, ship unflagged unless there's a specific reason to stage it)
