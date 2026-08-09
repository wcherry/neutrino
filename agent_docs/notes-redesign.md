# Notes Module Redesign → Links Service

**Date:** 2026-08-08  
**Status:** Proposed  
**Owner:** William Cherry

## Overview

Remove the notes-specific API layer and consolidate to **backlinks-only**. However, backlinks are **not notes-specific** — any file type (notes, docs, sheets, slides, drawings, photos) can link to any other file type.

The notes module is renamed/refactored to become a **Links Service** (`@neutrino/api-links` or `/api/v1/links/`) that manages the file graph for all file types. It handles:
- Tracking relationships between files (any type → any type)
- Resolving wiki link titles and other link formats to file IDs
- Returning backlinks (incoming links) for any file
- Permission filtering (only show links to files user can see)

## Architectural Decisions

### Decision 1: Remove Notes CRUD APIs, Keep Only Link Operations
**What's removed:**
- `POST /api/v1/notes` (create note)
- `GET /api/v1/notes` (list notes)
- `GET /api/v1/notes/{id}` (get note)
- `PATCH /api/v1/notes/{id}` (save note)
- `DELETE /api/v1/notes/{id}` (delete note)

**Rationale:**
- Notes module currently delegates to Drive for storage anyway (`DriveClient`)
- No business logic unique to notes creation/reading/deletion
- Removing this layer eliminates an abstraction that adds no value
- Frontend already has drive client; can call it directly
- All file types (docs, sheets, slides, etc.) should use same pattern

**Replaced by:** Drive API calls for all file operations (type-agnostic)

---

### Decision 2: Generic Links Service (File Graph)
**What the notes module becomes:**
- `POST /api/v1/links/{fileId}` (update outgoing links from any file type)
- `GET /api/v1/links/{fileId}/backlinks` (get incoming links to any file)
- `GET /api/v1/links/search` (resolve link targets by title/path across all file types)

**Rationale:**
- Backlinks are not notes-specific; docs, sheets, slides can all reference each other
- Requires cross-file graph updates (parsing, resolving titles, deduplication)
- Drive API has no concept of links; this new service owns the graph domain
- Single source of truth for all file relationships
- Enables bidirectional references: notes→docs, docs→sheets, etc.

**Scope:**
- Any file type can have outgoing links (via `[[Title]]`, `[text](uuid:...)`, or app-specific format)
- Any file type can have incoming links (backlinks)
- Permissions: user must have read access to link targets; must have edit access to source

---

### Decision 3: Frontend Extracts Links, Backend Resolves and Updates Graph
**Frontend responsibilities (app-specific):**
- Parse links from their content format (e.g., notes use `[[Title]]`, docs might use `[link](uuid:...)`)
- Send extracted link targets to links service

**New flow (type-agnostic):**
1. Frontend parses content → extracts link targets (format depends on app)
2. Frontend sends to `/api/v1/links/{fileId}` with `{ linkedTitles: ["Note A", "Doc B"], linkedIds?: [...] }`
3. Backend resolves titles → file IDs (or validates passed IDs)
4. Backend verifies user has edit access to source + read access to targets
5. Backend diffs old links vs new → added/removed
6. Backend updates `file_links` table (replaces `note_links`)

**Examples:**
```typescript
// Notes (already does this)
const linkedTitles = extractWikiLinks(content)  // ["Note A", "Note B"]
await linksApi.updateLinks(noteId, { linkedTitles })

// Future: Docs could send structured links
await linksApi.updateLinks(docId, { 
  linkedIds: ["uuid-1", "uuid-2"]  // UUIDs from embedded links
})

// Future: Sheets could send cell-based references
await linksApi.updateLinks(sheetId, { 
  linkedRanges: [
    { sheetId: "uuid-1", range: "A1:B10" },  // Link to cells in another sheet
  ]
})
```

**Rationale:**
- For E2EE notes, frontend already extracts links before encryption
- Each app owns parsing its content format
- Backend is simple and type-agnostic (just resolves + stores)
- Explicit added/removed lists enable partial updates (safer for concurrent edits)
- Extensible: new file types can add links without backend changes

---

### Decision 4: Backlinks Load on Editor Mount
**Frontend behavior:**
- On opening a note: fetch backlinks via `GET /api/v1/notes/{id}/backlinks`
- Display "X notes link to this" in the editor UI
- On save: update backlinks via PATCH if wiki links changed

**Rationale:**
- Same information users get now; no feature loss
- Keeps backlinks fresh for each edit session

---

## Detailed Changes

### Backend Changes

#### Removed (`src/notes/api.rs` endpoints)
```rust
// DELETE THESE
GET  /api/v1/notes                  → list_notes()
POST /api/v1/notes                  → create_note()
GET  /api/v1/notes/{id}             → get_note()
PATCH /api/v1/notes/{id}            → save_note()
DELETE /api/v1/notes/{id}           → delete_note()
GET  /api/v1/notes/{id}/backlinks   → get_backlinks()  [KEEP BUT SIMPLIFY]
```

#### New Endpoint
```rust
// ADD THIS
PATCH /api/v1/notes/{id}/backlinks  → update_backlinks()

Request body:
{
  "added": ["note-uuid-1", "note-uuid-2"],    // IDs to link to
  "removed": ["note-uuid-3"]                   // IDs to unlink from
}

Response: 204 No Content (or updated BacklinksResponse)
```

#### Simplified `get_backlinks()`
```rust
// Stays mostly as-is, but no longer validates user permissions
// (caller already checked permission via drive API)

GET /api/v1/notes/{id}/backlinks
→ BacklinksResponse { backlinks: [{ id, title }, ...] }
```

#### Removed Service Methods (`src/notes/service.rs` → `src/links/service.rs`)
```rust
// DELETE THESE (were notes-specific)
list_notes()
create_note()
get_note()
save_note()
delete_note()

// KEEP/RENAME (now generic file operations)
get_backlinks(user, file_id) → returns BacklinksResponse with file type info
parse_wiki_links()  → move to @neutrino/markdown utility

// ADD THIS (new generic method)
update_links(
  user: &AuthenticatedUser,
  source_file_id: &str,
  req: UpdateLinksRequest {
    linked_titles?: Vec<String>,      // For wiki-link style
    linked_ids?: Vec<String>,          // For UUID references
    linked_ranges?: Vec<LinkedRange>   // For cell references (future)
  }
) -> Result<BacklinksResponse, ApiError>
```

#### Database Schema: Rename `note_links` → `file_links`
```sql
-- Old
CREATE TABLE note_links (
  source_note_id TEXT NOT NULL,
  target_note_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_note_id, target_note_id)
);

-- New
CREATE TABLE file_links (
  source_file_id TEXT NOT NULL,     -- Any file type
  target_file_id TEXT NOT NULL,     -- Any file type
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_file_id, target_file_id)
);
```

**Why rename:**
- Old name implied notes-only
- New name is file-type-agnostic
- No migration needed if starting fresh; if migrating, `ALTER TABLE note_links RENAME TO file_links`

#### Repository Changes (`src/links/repository.rs` — renamed from `src/notes/repository.rs`)
```rust
// Renamed methods (same logic, generic names)
pub fn get_backlink_sources(&self, target_file_id: &str) -> Result<Vec<String>, ApiError>
pub fn batch_update_links(
  &self,
  source_file_id: &str,
  added: &[String],
  removed: &[String],
) -> Result<(), ApiError>

// Updated for multi-type support
pub fn delete_links_for_file(&self, file_id: &str) -> Result<(), ApiError>
  // Deletes all links where file_id is source OR target
```

---

### Frontend Changes

#### Note Editor (`web/apps/web/src/app/(apps)/notes/editor/page.tsx`)

**On load:**
```typescript
// Already does this
useQuery({
  queryKey: ['note-backlinks', noteId],
  queryFn: () => notesApi.getBacklinks(noteId),
})
```

**On save:** (lines ~204-241)
```typescript
const save = useCallback(async (serialized: string, nextTitle: string) => {
  // 1. Get all notes (already does this for wiki link resolution)
  const allNotes = await filesystemApi.getRootContents({ type: 'note' })
  
  // 2. Extract plaintext before encryption
  const linkedTitles = extractWikiLinkTitles(JSON.parse(serialized))
  
  // 3. Resolve titles → IDs
  const currentLinkIds = resolveNoteIds(linkedTitles, allNotes)
  
  // 4. Diff against previous state
  const oldLinkIds = new Set(lastLinksRef.current)
  const added = currentLinkIds.filter(id => !oldLinkIds.has(id))
  const removed = Array.from(oldLinkIds).filter(id => !currentLinkIds.has(id))
  
  // 5. Save note content via Drive API
  await storageApi.uploadFileContent(noteId, ...)
  
  // 6. Update backlinks if changed
  if (added.length > 0 || removed.length > 0) {
    await notesApi.updateBacklinks(noteId, { added, removed })
  }
  
  lastLinksRef.current = Array.from(currentLinkIds)
}, [])
```

#### New API Client (`web/packages/api-links/src/index.ts` — new package)

**Created (generic for all file types):**
```typescript
export const linksApi = {
  // Get backlinks for any file (notes, docs, sheets, etc.)
  async getBacklinks(fileId: string): Promise<BacklinksResponse> {
    return request<BacklinksResponse>(`/api/v1/links/${fileId}/backlinks`)
  },
  
  // Update outgoing links for any file
  async updateLinks(fileId: string, req: UpdateLinksRequest): Promise<BacklinksResponse> {
    return request<BacklinksResponse>(`/api/v1/links/${fileId}`, {
      method: 'PATCH',
      body: JSON.stringify(req)
    })
  }
}

export interface UpdateLinksRequest {
  linkedTitles?: string[]        // For wiki-link style (notes)
  linkedIds?: string[]           // For UUID references
  linkedRanges?: LinkedRange[]   // For cell references (future)
}

export interface BacklinksResponse {
  backlinks: {
    id: string
    title: string
    type: 'note' | 'doc' | 'sheet' | 'slide' | 'drawing' | 'photo'  // File type
  }[]
}
```

#### Old API Client (`web/packages/api-notes/src/index.ts`) — Simplify to Remove CRUD

**Removed:**
```typescript
notesApi.listNotes()
notesApi.createNote()
notesApi.getNote()
notesApi.saveNote()
notesApi.deleteNote()
```

**Kept (for backwards compatibility or migration):**
```typescript
// Use linksApi instead
notesApi.getBacklinks()  // Redirect to linksApi.getBacklinks()
```

#### Note List Page (`web/apps/web/src/app/(apps)/notes/page.tsx`)
**Change:** Use `filesystemApi.getRootContents({ type: 'note' })` instead of `notesApi.listNotes()`

#### Note Creation (FAB, etc.)
**Change:** Use `storageApi.createFile(...)` with MIME type `application/x-neutrino-note` instead of `notesApi.createNote()`

#### Takeout Import (`web/packages/web/src/lib/takeout/importKeep.ts`)
**Change:** Use drive APIs for create/save operations instead of notes APIs

#### Other Apps (Docs, Sheets, Slides, etc.)
**Future:** Once ready, these can also use `linksApi` for their own link types:
```typescript
// Docs: embedded links like [text](uuid:doc-uuid)
await linksApi.updateLinks(docId, { linkedIds: extractDocLinks(content) })

// Sheets: cell references to other sheets
await linksApi.updateLinks(sheetId, { linkedRanges: extractSheetReferences(content) })

// Drawings: embedded images/objects
await linksApi.updateLinks(drawingId, { linkedIds: extractDrawingAssets(content) })
```

---

## Resolved Decisions

### 1. **Wiki Link Parsing → Frontend Markdown Utility**
**Decision:** Create a shared frontend markdown parsing utility in `@neutrino/utils` or new `@neutrino/markdown`.

**Rationale:**
- Markdown is useful in many contexts (docs, sheets, search, etc.)
- Parsing should be testable client-side
- Keep complex parsing logic in one place

**Implementation:**
```typescript
// @neutrino/markdown/src/parser.ts
export function extractWikiLinks(content: string): string[] {
  // Parse [[Title]] patterns
}

export function parseMarkdownBlocks(content: string): Block[] {
  // Full block parsing for notes
}
```

**Used in:**
- Note editor (before encryption, for `linkedTitles` extraction)
- Search indexer (text extraction)
- Takeout import (Keep HTML → markdown)

---

### 2. **Note ID Resolution → Backend Resolves from LinkedTitles**
**Decision:** Frontend sends `linkedTitles` (title strings), backend resolves to note IDs.

**Frontend flow:**
```typescript
const content = serializeBlocks(blocks)
const linkedTitles = extractWikiLinks(content)  // ["Note A", "Note B"]

await notesApi.updateBacklinks(noteId, {
  linkedTitles,  // ← Send titles, not IDs
  contentEncoding?: 'base64url'
})
```

**Backend flow:**
```rust
pub async fn update_backlinks(
  &self,
  user: &AuthenticatedUser,
  note_id: &str,
  req: UpdateBacklinksRequest {
    linked_titles: Vec<String>,
  }
) -> Result<BacklinksResponse, ApiError> {
  // 1. Get all notes user can access via drive API
  let accessible_notes = self.drive.list_files(user, MIME_TYPE).await?;
  
  // 2. Resolve titles → IDs (case-insensitive)
  let mut new_target_ids: Vec<String> = linked_titles
    .iter()
    .filter_map(|title| {
      accessible_notes
        .iter()
        .find(|f| f.name.to_lowercase() == title.to_lowercase() && f.id != note_id)
        .map(|f| f.id.clone())
    })
    .collect();
  
  // 3. Get old links, compute diff
  let old_target_ids = self.repo.get_backlink_targets(note_id)?;
  let added = new_target_ids.iter().filter(|id| !old_target_ids.contains(id)).cloned().collect();
  let removed = old_target_ids.iter().filter(|id| !new_target_ids.contains(id)).cloned().collect();
  
  // 4. Update links atomically
  self.repo.batch_update_links(note_id, &added, &removed)?;
  
  // 5. Return current backlinks
  self.get_backlinks(user, note_id).await
}
```

**Rationale:**
- Backend can verify user has access to all linked notes (at read level minimum)
- Safer: prevents linking to inaccessible notes
- Simpler frontend: no need to maintain note ID mapping
- Single source of truth for permissions

---

### 3. **Concurrent Edits → Generalize `PresenceRoom` into a Shared Drive-Wide Service**
**Correction (2026-08-08):** Verified against the actual codebase — Docs and Sheets do **not** use a "parent app" pattern; no such concept exists anywhere in this repo. What they actually do:
- **Docs** runs real CRDT collaboration (Yjs) at `src/docs/collab/api.rs` — a live `yrs::Doc` per room, genuinely different from anything notes needs.
- **Sheets** uses the exact same mechanism notes already has: a signal-only, last-write-wins socket backed by the generic `PresenceRoom` primitive (`src/shared/presence_room.rs`), one instance per app at `/api/v1/{app}/{id}/ws`.

There is currently no single shared, drive-wide socket — each app mounts its own endpoint on top of the same reusable `PresenceRoom` type. **Decision: generalize this into one real shared service** rather than continuing the per-app-socket pattern, since we're already building a type-agnostic links layer.

**Target architecture:**
```
src/shared/presence_room.rs        ← existing generic primitive, keyed by file id (unchanged)
src/shared/file_events/            ← NEW: one WS endpoint for all apps
  api.rs   → GET /api/v1/files/{id}/ws   (auth + room lookup, replaces per-app routes)
  state.rs → DashMap<file_id, Arc<PresenceRoom>>, same map notes/sheets/slides already use today, unified

Any client (notes, sheets, slides, future docs presence, links UI)
  ↓ opens ONE socket per open file, at /api/v1/files/{id}/ws
  ↓ subscribes to signals for that file id: content changed, links changed, deleted, renamed
```

**Frontend Implementation:**
```typescript
// Replaces useNoteSync/useSheetSync/useSlideSync with one shared hook
const { connected, broadcast } = useFileSync({ fileId: noteId, enabled: !!noteId })

// After a successful save, tell other viewers to re-read
await storageApi.uploadFileContent(noteId, content)
await linksApi.updateLinks(noteId, { linkedTitles })
broadcast({ type: 'file:updated' })

// Listen for updates from any source (another tab, another user, backlink change)
connection.subscribe('file:updated', () => {
  queryClient.invalidateQueries({ queryKey: ['note-content', noteId] })
  queryClient.invalidateQueries({ queryKey: ['note-backlinks', noteId] })
})
```

**Backend Changes:**
- Add `src/shared/file_events/` module: one route, one `DashMap<String, Arc<PresenceRoom>>` shared across all file types
- Migrate notes and sheets presence routes onto it; slides follows once notes/sheets are proven out
- Docs' CRDT socket stays separate — different problem (live document state vs. a change signal) — do not fold it in
- No locking, no queuing, no owner election — still last-write-wins, just on a unified transport

**Rationale:**
- `PresenceRoom` is already file-id-keyed and reusable; the only thing missing is a single route instead of three copies
- Matches the actual "common message service" goal (see Future section) without inventing a parent/child protocol that has no precedent in this codebase
- Avoids building CRDT-level complexity for notes when the simpler signal model already meets "multiple people can edit, last save wins" — revisit only if that proves insufficient in practice

---

### 4. **Permission Checks → Read Access Required**
**Decision:** User must have at least **read** access to link to a note. Fail silently if no access.

**Backend validation in `update_backlinks()`:**
```rust
// Verify source note (user must own or edit)
let source_file = self.drive.get_file(user, note_id, "").await?;
match source_file.your_role.as_str() {
  "owner" | "editor" => {}
  _ => return Err(ApiError::forbidden("Edit access required"))
}

// Verify each linked note exists and user can see it
for title in &req.linked_titles {
  let target = accessible_notes
    .iter()
    .find(|f| f.name.to_lowercase() == title.to_lowercase())?;
  
  // If target deleted, treat as inaccessible
  if target.deleted_at.is_some() {
    continue;  // Silently skip
  }
  
  // If user has no read access, silently skip
  if !["owner", "editor", "viewer"].contains(&target.your_role.as_str()) {
    continue;
  }
  
  resolved_ids.push(target.id.clone());
}
```

**Frontend behavior:**
- Doesn't need to check; backend handles it
- If title resolves to no ID, no link is created (silent)
- Same UX as if note was deleted

**Rationale:**
- Prevents "ghost" links to inaccessible notes
- Frontend doesn't need permission logic
- Consistent with drive's access model

---

### 5. **Backlinks to Deleted/Inaccessible Notes → Same as #4**
**Decision:** Backend filters both deleted notes and notes without read access when returning backlinks.

**Updated `get_backlinks()`:**
```rust
pub async fn get_backlinks(
  &self,
  user: &AuthenticatedUser,
  note_id: &str,
) -> Result<BacklinksResponse, ApiError> {
  let file = self.drive.get_file(user, note_id, "Note not found").await?;
  if file.deleted_at.is_some() {
    return Err(ApiError::not_found("Note is in trash"));
  }
  
  let source_ids = self.repo.get_backlink_source_ids(note_id)?;
  let mut backlinks = Vec::new();
  
  for source_id in &source_ids {
    // Check: file exists, not deleted, user can read
    if let Ok(source_file) = self.drive.get_file(user, source_id, "").await {
      if source_file.deleted_at.is_none() 
        && ["owner", "editor", "viewer"].contains(&source_file.your_role.as_str()) {
        backlinks.push(NoteLinkItem {
          id: source_file.id,
          title: source_file.name,
        });
      }
    }
  }
  
  Ok(BacklinksResponse { backlinks })
}
```

**Rationale:**
- User should never see links to inaccessible content
- Mirrors drive's permission model
- Consistent with #4

---

### 6. **Search Index Updates**
**Decision:** Already in frontend (`indexOnSave`), no changes needed.

**Current flow (already correct):**
- Note editor calls `indexOnSave()` after successful PATCH
- Takeout import calls `indexOnSave()` for each imported note
- Both paths call `extractNoteText()` from `@neutrino/api-notes`

**No changes required.**

---

### 7. **WebSocket Collaboration → Same Generalized Service as Decision 3**
**Decision:** Superseded by Decision 3 above — this is the same piece of work, not a separate one. Remove note-specific `/api/v1/notes/{id}/ws` in favor of the new shared `src/shared/file_events/` endpoint (`/api/v1/files/{id}/ws`), which does not exist yet and must be built (see Decision 3's "target architecture" and the Implementation Order below).

**Note:** this endpoint is **new infrastructure**, not something to "use... already in place" — confirmed by direct code inspection that no drive-wide socket currently exists. Sheets and slides keep their own routes until migrated over; migrating them is out of scope for this notes redesign but should reuse the same `src/shared/file_events/` module once it exists.

**Benefits (once built):**
- Eliminates note-specific WebSocket infrastructure
- Reuses the existing `PresenceRoom` primitive, just behind one route instead of three
- One message bus for file changes across apps that adopt it
- Foundation for the "common message service" described in the Future section

**Rationale:**
- Notes and sheets already share the identical signal-only mechanism under the hood (`PresenceRoom`); unifying the route removes duplication that exists today
- Docs' CRDT socket is intentionally excluded — different problem, do not force it onto this transport

---

## Migration Path

1. **Phase 1:** Add new backlinks endpoints (`PATCH /api/v1/notes/{id}/backlinks`, updated `GET`)
2. **Phase 2:** Update frontend to use new endpoints (feature flag)
3. **Phase 3:** Migrate Drive usage in editor/list/create (feature flag)
4. **Phase 4:** Remove old notes APIs (delete endpoints, service methods)
5. **Phase 5:** Simplify repository (no more `replace_links`, add `batch_update_links`)

---

## Updated API Contracts (Links Service)

### New Endpoint: Update Links for Any File
```
PATCH /api/v1/links/{fileId}

Request (flexible — app specifies link format):
{
  "linkedTitles": ["Note A", "Doc B", "Sheet C"],   // For wiki-link style
  // OR
  "linkedIds": ["uuid-1", "uuid-2"],                 // For UUID references
  // OR
  "linkedRanges": [                                  // For cell references (future)
    { "sheetId": "uuid-1", "range": "A1:B10" }
  ]
}

Response (204 No Content, or for debugging):
{
  "backlinks": [
    { 
      "id": "uuid-1", 
      "title": "Note Linking Back",
      "type": "note"  // File type (for future use)
    },
    { 
      "id": "uuid-2", 
      "title": "Another Doc",
      "type": "doc"
    }
  ]
}

Errors:
- 403 Forbidden: User lacks edit permission on this file
- 404 Not Found: File doesn't exist or is deleted
- 400 Bad Request: Invalid link format or unresolvable links
```

**Behavior:**
1. Verify user has edit access to source file (`fileId`)
2. Resolve links to file IDs:
   - If `linkedTitles`: search drive for files matching titles (user must have read access)
   - If `linkedIds`: validate IDs exist and are readable (user must have read access)
   - If `linkedRanges`: validate target sheets exist (future enhancement)
3. Silently skip any inaccessible/deleted targets
4. Compute diff against current `file_links` table
5. Batch insert/delete (atomic transaction)
6. Return current backlinks visible to user

---

### Endpoint: Get Backlinks for Any File
```
GET /api/v1/links/{fileId}/backlinks

Response:
{
  "backlinks": [
    { 
      "id": "uuid-1", 
      "title": "Note A",
      "type": "note"
    },
    { 
      "id": "uuid-2", 
      "title": "Doc B",
      "type": "doc"
    }
  ]
}

Errors:
- 403 Forbidden: User lacks read permission
- 404 Not Found: File doesn't exist or is deleted
```

**Behavior:**
- Query `file_links` table for all files linking to `{fileId}`
- Filter: only return if user has read access and file isn't deleted
- Include file type in response (helpful for UI rendering)

---

## Updated Frontend Architecture

### Note Editor Flow

**On Mount:**
```typescript
// 1. Fetch note metadata
const { data: note } = useQuery({
  queryKey: ['note', noteId],
  queryFn: () => storageApi.getFileInfo(noteId),  // ← Drive API, not notes
})

// 2. Fetch note content (via contentUrl from drive)
const { data: content } = useQuery({
  queryKey: ['note-content', noteId],
  queryFn: () => driveReadContent(note.contentUrl),
})

// 3. Fetch backlinks
const { data: backlinks } = useQuery({
  queryKey: ['note-backlinks', noteId],
  queryFn: () => notesApi.getBacklinks(noteId),  // ← Notes API (only one left doing real work)
})
```

**On Save:**
```typescript
// 1. Parse wiki links before encryption
const markdown = serializeBlocks(blocks)
const linkedTitles = extractWikiLinks(markdown)

// 2. Encrypt content client-side
let contentToSend = markdown
let encoding: 'base64url' | undefined
if (dekRef.current) {
  contentToSend = toBase64url(encryptFile(...))
  encoding = 'base64url'
}

// 3. Upload content via drive API
await storageApi.uploadFileContent(noteId, contentToSend, {
  contentEncoding: encoding,
})

// 4. Update backlinks via notes API (passes linkedTitles, backend resolves)
await notesApi.updateBacklinks(noteId, { linkedTitles })

// 5. Broadcast to other clients via drive WebSocket
broadcastFileUpdate({ type: 'note', fileId: noteId })

// 6. Update search index
indexOnSave(userId, { id: noteId, type: 'note', ... })
```

**On Remote Update (via WebSocket):**
```typescript
// Listen to drive WebSocket for file updates
connection.subscribe('file:updated', (event) => {
  if (event.type === 'note' && event.id === noteId) {
    // Refetch fresh content, metadata, and backlinks
    queryClient.invalidateQueries({ queryKey: ['note', noteId] })
    queryClient.invalidateQueries({ queryKey: ['note-content', noteId] })
    queryClient.invalidateQueries({ queryKey: ['note-backlinks', noteId] })
  }
})
```

---

## Risk Assessment

| Area | Risk | Mitigation |
|------|------|-----------|
| Data loss during migration | Medium | Keep old notes APIs for 2 weeks, dual-write during transition, feature flag |
| Title resolution inconsistency | Low | Backend always resolves; frontend just extracts titles |
| Backlink cycles (A→B→A) | Low | No validation needed; cycles are valid in knowledge graphs |
| Parent app failover | Medium | Use existing drive WebSocket failover (already handles offline) |
| Search index gaps | Low | Already in frontend; takeout import already calls indexOnSave |
| Permission leaks | Low | Backend filters backlinks and linked notes by user access |

---

## Implementation Order

### Backend
1. **Refactor schema**: Rename `note_links` → `file_links` (add MIME type tracking for backlinks)
2. **Create `src/links/` module** (refactored from `src/notes/`)
   - `repository.rs` - generic file link operations
   - `service.rs` - `update_links()`, `get_backlinks()` (both type-agnostic)
   - `api.rs` - HTTP endpoints `/api/v1/links/{fileId}` and `/api/v1/links/{fileId}/backlinks`
   - `dto.rs` - `UpdateLinksRequest` (flexible: `linkedTitles`, `linkedIds`, `linkedRanges`)
3. **Create shared markdown utility** (extract from `src/notes/service.rs`)
   - Move `parse_wiki_links()` to `src/shared/markdown.rs` or shared crate
4. **Keep `src/notes/` minimal** (for now)
   - Can be removed later once all references migrated
   - Or keep for note-specific operations (if any emerge)

### Frontend
5. **Create `@neutrino/markdown` package** with `extractWikiLinks()` function
6. **Create `@neutrino/api-links` package** with generic `linksApi` client
7. **Update note editor** (`page.tsx`) to:
   - Use `storageApi` (drive API) for content save
   - Use `linksApi.updateLinks()` for backlinks (send `linkedTitles`)
   - Listen to drive WebSocket for file updates
8. **Update note list page** to use `filesystemApi.getRootContents({ type: 'note' })`
9. **Update takeout import** to use drive APIs for file creation
10. **Update `@neutrino/api-notes` package** (optional)
    - Remove or deprecate CRUD methods
    - Keep `getBacklinks()` for backwards compatibility (delegate to `linksApi`)

### Cleanup (Phase 2)
11. **Remove old notes CRUD endpoints** (`POST/GET/PATCH/DELETE /api/v1/notes*`)
12. **Remove note-specific WebSocket** (`/api/v1/notes/{id}/ws`)
13. **Archive `src/notes/` module** (if not used by notes-specific logic)

---

## Future: Unified File Graph and Message Service

This redesign creates a foundation for three major architectural improvements:

### 1. **Unified File Graph Service** (`@neutrino/api-links`)
- Notes, docs, sheets, slides can all link to each other
- Bidirectional references: "What links to this sheet?"
- Type-agnostic backlinks enable knowledge discovery
- Foundation for dependency analysis, broken links, orphaned files

### 2. **Common Message Service**
Once this is complete, all file types will use shared drive infrastructure for updates:

```
Any File Type (notes, docs, sheets, photos)
  ↓ saves content to
Drive API (storage layer)
  ↓ broadcasts update via
Shared WebSocket (drive service)
  ↓ triggers
Search Index Updates
Live Collaboration (parent app pattern)
System Notifications
```

This unifies how all file types handle collaboration, versioning, and discovery.

### 3. **Graph Operations and AI**
With a unified links table, future features become possible:
- Graph search: "Show me all notes connected to this topic"
- Orphan detection: "Which docs have no backlinks?"
- Relationship suggestions: "You have 5 notes about this, link them together?"
- AI summarization: "Summarize the connected documents"
- Impact analysis: "What breaks if I delete this file?"

