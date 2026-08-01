# Feature: Drive Tags (UI)

Branch: `feature/drive-tags`

> **Status: Phase 1 implemented**, plus every backend gap in "Backend gaps and
> bugs" below. Client-side `tag:` search was added on top of Phase 1 (see
> "Search", below). Phase 2 (tag chips on file rows, `?tag=` on the main
> listing) and Phase 3 (colors) remain open.

## Summary

The Drive tagging subsystem is fully implemented and mounted on the backend
(`src/drive/tags/`, mounted at `/api/v1/drive` via `src/drive/mod.rs:44`) but
has **zero client usage** — no `tagsApi` in `web/packages/api-drive/`, no
types, no UI. `grep -rn "tag" web/apps/web/src` returns only unrelated hits
(the `Tag` lucide icon used as the *file type* row label in
[FileInfoPanel.tsx](web/apps/web/src/app/(apps)/drive/FileInfoPanel.tsx#L92),
diagram/sheet internals, etc.).

This document defines the user-facing tags feature to be built on top of the
existing endpoints, the backend gaps that block parts of it, and the phasing.

## What the backend already gives us

All routes are live under `/api/v1/drive`. Note that
[unused-apis.md](unused-apis.md#L89-L99) is **inaccurate** for this subsystem —
it omits three routes and lists one that doesn't exist. Actual surface
(`src/drive/tags/api.rs:269-280`):

| Method | Path | Handler | Notes |
|---|---|---|---|
| POST | `/drive/tags` | `create_tag` | 201, 409 on duplicate name |
| GET | `/drive/tags?q=` | `list_tags` | `q` = `LIKE %q%` on name, ordered by name |
| GET | `/drive/tags/{id}` | `get_tag` | |
| PATCH | `/drive/tags/{id}` | `rename_tag` | 409 on duplicate name |
| DELETE | `/drive/tags/{id}` | `delete_tag` | cascades `file_tags` rows |
| GET | `/drive/tags/{id}/files` | `get_files_for_tag` | **not in unused-apis.md** |
| GET | `/drive/files/{id}/tags` | `get_file_tags` | **not in unused-apis.md** |
| PUT | `/drive/files/{id}/tags` | `set_file_tags` | replace-all; **unused-apis.md wrongly lists this as POST** |
| POST | `/drive/files/{id}/tags/{tag_id}` | `add_file_tag` | 204 |
| DELETE | `/drive/files/{id}/tags/{tag_id}` | `remove_file_tag` | 204 |

Data model (`migrations/00056_drive__2026-04-02-000035_create_tags/up.sql`):

```sql
tags(id, user_id, name, created_at)   UNIQUE(user_id, name)
file_tags(file_id, tag_id)            PK(file_id, tag_id), both FK ON DELETE CASCADE
```

### The product semantics this model implies

Tags are **private, per-user labels**, not shared file metadata — closer to
Gmail labels than to Drive's shared properties:

- A tag belongs to one user (`tags.user_id`). Every read path filters
  `tags.user_id = me` (`repository.rs:212`, `repository.rs:272`), so you only
  ever see your own tags, even on a file shared with you.
- You may tag any file you have **editor or owner** access to
  (`service.rs:189-198`), including files you don't own — the tag is still
  yours alone; the owner never sees it.
- Tag names are **plaintext in the DB**. For E2EE files this is metadata
  leakage the user should understand: filenames may be encrypted, but the
  label you put on them is not. The UI must not imply otherwise.

The UI copy and IA below assume this "private labels" framing. If we instead
want tags to be shared file metadata visible to all collaborators, that is a
different (much larger) backend change — see Open Questions.

## Feature scope

### Phase 1 — usable tagging with zero backend changes

**1. `tagsApi` client + types** — `web/packages/api-drive/src/`

- `types.ts`: `Tag`, `ListTagsResponse`, `TaggedFile`, `ListTaggedFilesResponse`,
  `CreateTagRequest`, `UpdateTagRequest`, `SetFileTagsRequest`.
- `client.ts`: `tagsApi` with `list(q?)`, `get(id)`, `create(name)`,
  `rename(id, name)`, `remove(id)`, `filesForTag(id)`, `forFile(fileId)`,
  `setForFile(fileId, tagIds)`, `addToFile(fileId, tagId)`,
  `removeFromFile(fileId, tagId)`. Follow the existing `storageApi`/
  `filesystemApi` shape — thin `request()` wrappers, no normalization needed
  (the backend already serializes camelCase).
- `index.ts`: export the value and the types.

**2. `TagPicker` component** — `apps/web/src/app/(apps)/drive/TagPicker.tsx`

An inline disclosure that owns its own "Add tag" trigger. *Not* a `Popover`:
its host is the file info panel, a 300px fixed sidebar with `overflow-y: auto`,
which clips absolutely-positioned children at its edges — the first cut used
`Popover` and the picker rendered half off the panel. Normal flow needs no
positioning math and cannot be clipped. It keeps popover semantics
(outside-click and Escape dismiss) via its own root ref.

- Search input filtered against `tagsApi.list(q)` (server-side `q` param).
- Checkbox list of all the user's tags, checked = applied to this file.
- "Create *«query»*" row when the typed text matches no existing tag —
  `create` then `addToFile`.
- Writes with `addToFile`/`removeFromFile` (204, per-tag, idempotent —
  `insert_or_ignore`) rather than `setForFile`, so two rapid toggles can't
  clobber each other.
- Optimistic update on `['file-tags', fileId]`, rollback on error, toast on
  failure. Invalidate `['tags']` after a create and `['tag-files', tagId]`
  for both sides of a toggle.

**3. Tags section in the file info panel** — `FileInfoPanel.tsx`

New section below "Details": chips for each tag (`Badge` + an `×` remove
button) and an "Add tag" trigger opening `TagPicker`. Query
`['file-tags', file.id]` → `tagsApi.forFile`. Hidden (or read-only) when the
user's role on the file is `viewer`/`commenter` — writes 403 otherwise.

**4. Context menu entry** — `FileContextMenu.tsx`

`{ icon: <Tag size={14} />, label: 'Manage tags', action: onManageTags }`,
placed next to "Star". Opens the info panel with the tag section focused
(simplest — avoids a second popover anchoring path from a menu that unmounts
on click).

**5. Tags in the sidebar** — `apps/web/src/lib/tagNav.ts`, wired in
`apps/web/src/app/(apps)/layout.tsx`

A `NavSection` rendered after `team`, populated from the shared `['tags']`
query: one item per tag (`Tag` icon, `href: /drive/tags/${id}`, file count as
a badge) ordered by usage — most-tagged first, alphabetical on ties. Capped at
`MAX_SIDEBAR_TAGS` (8) with an "All tags" link to `/drive/tags` at the end.

The section is **always rendered**, including for a user with no tags (as a
single "Tags" entry, no heading). An earlier cut hid it until at least one tag
was in use, which made the feature undiscoverable: `/drive/tags` had no other
navigation route, and the only way to create a first tag was through a file's
context menu. Unused tags sort last rather than being hidden, and their badge
is omitted instead of showing a zero.

**6. Tag detail page** — `apps/web/src/app/(apps)/drive/tags/[id]/page.tsx`

`GET /drive/tags/{id}` for the heading, `GET /drive/tags/{id}/files` for
contents, rendered with the shared `FileGrid` (same `GridItem` mapping the
Drive page uses). Header has a kebab menu with Rename (inline `TextInput`,
409 → "A tag with that name already exists") and Delete (confirm modal —
copy must say the *files are not deleted*, only the label). `EmptyState` with
the `Tag` icon when the tag has no files. Deleting redirects to `/drive`.

**7. Manage tags view** — `apps/web/src/app/(apps)/drive/tags/page.tsx`

Flat list of all tags with file counts, rename/delete inline, and a create
input. This is also where the sidebar overflow lands.

### Phase 2 — requires small backend additions

**8. Tag chips on file rows/cards.** Blocked: neither the flat file list
(`GET /drive/files`) nor folder contents include tags, so rendering chips per
row would be an N+1 of `GET /drive/files/{id}/tags`. Fix on the backend —
`TagsRepository::get_tag_names_for_files` (`repository.rs:225`) already does
the batched lookup and is currently `#[allow(dead_code)]`; wire it into the
filesystem/storage list DTOs as `tags: Vec<String>` and mirror it on
`FileItem` in `types.ts`. Then add a `tags?: string[]` field to `GridItem` and
render up to two chips + "+N" in list view.

**9. Filter the main Drive listing by tag.** `GET /drive/files?tag=` /
`?tagId=` alongside the existing `view`/`type` params, so tags compose with
the `FILTER_CHIPS` row in `FileGrid` instead of living only on a separate
page.

### Phase 3 — optional

**10. Tag colors.** `tags` has no color column. A migration adding
`color TEXT NULL` + a swatch in the picker makes chips scannable; without it
every chip is the same grey. Cheap, high visual payoff — but it is a schema
change, so it is deliberately not in Phase 1.

**11. Search integration.** `packages/search` and `GET /drive/search` are
themselves unused today (unused-apis.md §6). If/when search UI lands,
`tag:foo` should be a supported filter token. Out of scope here.

## Search

Topbar search now resolves tags client-side, alongside the encrypted content
index. `web/apps/web/src/lib/tagSearch.ts` holds the pure logic; `(apps)/layout.tsx`
wires it to the query cache.

- `tag:taxes` — files carrying that tag. `tag:"Q1 report"` for names with
  spaces. Multiple filters are AND (`tag:a tag:b` = tagged both).
- `tag:taxes budget` — the tag filter narrows the content-index hits.
- A term matching no tag returns nothing, rather than degrading to an
  unfiltered search.
- A query with no prefix also matches tag *names*, so typing "taxes" surfaces
  files you labelled that way beneath the content hits.

Why client-side: file content is E2EE and already searched in the browser.
Tag names are server-side plaintext and could be matched by the API, but a
server-side tag filter could never intersect with the encrypted content index —
doing both here keeps one search path.

## Backend gaps and bugs found while scoping

All of these are now fixed; the descriptions are kept as the record of what was
wrong. Covered by ten new repository tests in `src/drive/tags/repository.rs`.

1. **FIXED** — `TaggedFileResponse` (`dto.rs:54-62`) omitted
   `is_starred`, `cover_thumbnail`, `cover_thumbnail_mime_type`, and
   `content_version`, all of which `FileItem`/`GridItem` consume. The tag
   detail page would render thumbnail-less cards with no star state. Fix:
   return the same shape as the filesystem listing rather than a bespoke DTO.

2. **FIXED** — `GET /drive/tags/{id}/files` had no pagination;
   `get_files_for_tag` loaded every match. Now takes `limit` (default 50, max
   200) and `offset`, and returns them alongside `total`.

3. **FIXED — you could tag a shared file but never see it again.**
   `set_file_tags`/`add_file_tag` authorize on *effective role*, so an editor
   can tag a file owned by someone else — but `get_files_for_tag` filtered
   `files.user_id = me`, so that file never appeared under its tag. The repo
   query no longer filters by owner; the service filters by access (ownership
   or an effective role) before paginating, so `total` stays honest.

4. **FIXED — `remove_file_tag` didn't verify tag ownership.** It checked file
   edit rights but, unlike `add_file_tag`, never called
   `find_tag(tag_id, &user.user_id)`, so any editor of a file could detach
   another user's tag by id. Now 404s on a tag the caller doesn't own.

5. **FIXED (found while fixing #4) — `set_file_tags` wiped every user's tags.**
   The replace-all delete was `WHERE file_id = ?` with no tag-owner scope, so
   one editor calling `PUT /files/{id}/tags` destroyed the owner's private
   labels on that file. The delete is now scoped to the caller's own tags.

6. **Trashed files** — `get_files_for_tag` filters `deleted_at IS NULL`, so
   trashed files drop out of tag views and return on restore. Correct as-is;
   now covered by a test, as are the per-tag counts.

7. **Folders can't be tagged.** `file_tags.file_id` FKs `files(id)` only.
   Product decision, not a bug — the UI accordingly offers "Manage tags" only
   in `FileContextMenu`, never `FolderContextMenu`.

8. **FIXED** — no file-count in `ListTagsResponse`. `TagResponse` now carries
   `fileCount` (non-trashed files, one grouped query), which is what orders
   the sidebar by usage. Tags still have no `updated_at`; nothing needs it.

## Files touched

**Backend**

```
src/drive/tags/dto.rs          fileCount, full file shape, paging fields
src/drive/tags/repository.rs   count_files_per_tag, owner-scoped set_file_tags,
                               access-agnostic get_files_for_tag, + 10 tests
src/drive/tags/service.rs      access filtering, paging, tag-ownership checks
src/drive/tags/api.rs          limit/offset query params + OpenAPI
```

**Frontend**

```
web/packages/api-drive/src/types.ts          + tag types
web/packages/api-drive/src/client.ts         + tagsApi
web/packages/api-drive/src/index.ts          + exports
web/apps/web/src/lib/tagSearch.ts                          (new) query parsing
web/apps/web/src/lib/tagNav.ts                             (new) sidebar ordering
web/apps/web/src/app/(apps)/drive/TagPicker.tsx            (new)
web/apps/web/src/app/(apps)/drive/TagPicker.module.css     (new)
web/apps/web/src/app/(apps)/drive/gridItems.ts             (new) extracted mappers
web/apps/web/src/app/(apps)/drive/tags/page.tsx            (new)
web/apps/web/src/app/(apps)/drive/tags/[id]/page.tsx       (new)
web/apps/web/src/app/(apps)/drive/tags/tags.module.css     (new)
web/apps/web/src/app/(apps)/drive/FileInfoPanel.tsx        tags section
web/apps/web/src/app/(apps)/drive/FileInfoPanel.module.css chip styles
web/apps/web/src/app/(apps)/drive/FileContextMenu.tsx      "Manage tags"
web/apps/web/src/app/(apps)/drive/page.tsx                 wire onManageTags
web/apps/web/src/app/(apps)/drive/routeForFile.ts          + hrefForFile
web/apps/web/src/app/(apps)/layout.tsx                     Tags nav + tag search
```

`gridItems.ts` extracts `fileToGridItem`/`folderToGridItem` (and their
formatters) out of `drive/page.tsx` so the tag detail page renders files
identically to My Drive rather than re-implementing the mapping.

## Query keys

| Key | Source | Invalidated by |
|---|---|---|
| `['tags']` | `tagsApi.list()` | create / rename / delete |
| `['file-tags', fileId]` | `tagsApi.forFile` | add / remove on that file |
| `['tag', tagId]` | `tagsApi.get` | rename |
| `['tag-files', tagId]` | `tagsApi.filesForTag` | add / remove on any file, tag delete |

The picker filters `['tags']` client-side instead of refetching per keystroke;
the sidebar keeps that entry warm, so typing costs no requests.

## Tests

Frontend — 41 tests under `web/apps/web/src/__tests__/drive/`:

- `tagSearch.test.ts` (14) — `tag:` parsing incl. quoted names and multiple
  filters, case-insensitive matching, exact-match precedence, unknown-tag →
  null, AND intersection.
- `TagPicker.test.tsx` (8) — lists tags with counts and checked state, filters
  on typing, add/remove toggling, "Create «x»" only without an exact match,
  create-then-apply, 403 → "needs edit access", 409 → duplicate name.
- `TagsPage.test.tsx` (7) — usage ordering, counts, create, rename, delete
  confirmation copy, duplicate-name error, empty state.
- `FileInfoPanelTags.test.tsx` (6) — chips render, removal, optimistic drop
  before the request resolves, rollback + message on 403, `focusTags`.
- `tagNav.test.ts` (6) — usage ordering, alphabetical tie-break, badge/href,
  unused tags omitted, null when nothing is tagged, cap + "All tags".

Backend — 10 repository tests in `src/drive/tags/repository.rs`: per-user name
uniqueness, cross-user isolation, cascade on delete, idempotent add, the two
`set_file_tags` scoping cases, trashed-file exclusion, shared files returned,
and count correctness.

## Verification

- `cargo test --bin neutrino` — 205 passed, 0 failed.
- `pnpm vitest run apps/web/src/__tests__/drive` — the 41 new tests pass. Three
  pre-existing `DriveAreaDrop.test.tsx` failures are unchanged from `main`.
- Full `pnpm test`: 9 failing files / 36 failing tests, byte-identical to the
  clean-tree baseline (calendar, sheets, admin — all unrelated).
- `tsc --noEmit` clean for every touched file; `next lint` adds no new warnings.
- `cargo fmt` applied to the four tags files only (the repo has pre-existing
  drift elsewhere that was left alone).

## Still open

- **Phase 2** — tag chips on file rows (needs `tags` on the list DTOs;
  `get_tag_names_for_files` is written and still `#[allow(dead_code)]`) and
  `?tag=` on the main listing.
- **Phase 3** — tag colors, search-token integration with `packages/search`.
- `PUT /files/{id}/tags` has no client caller: the picker toggles per tag so
  concurrent toggles can't clobber each other. Kept (and now correctly scoped)
  for API completeness.

## Open questions

1. **Private labels or shared metadata?** The schema says private-per-user.
   Confirm that's the intent before we ship copy that commits to it —
   switching later means a `tags.user_id` → workspace/file-scoped migration.
2. **Colors in Phase 1?** One migration + a swatch picker; materially better
   chips. Include or defer?
3. **Scope beyond Drive.** Notes, Photos, and Calendar have their own
   organizing primitives (albums, task lists). Tags stay Drive-only here —
   confirm we don't want a cross-app label system, which would be a different
   backend design.
4. **Phase 2 now or later?** Chips on file rows are what make tags feel real
   while browsing; the backend change is small (`get_tag_names_for_files` is
   already written). Not built — worth doing next?

Questions 1 and 3 were not blocking: the shipped copy states the private-labels
model plainly ("Tags are private to you — collaborators on a shared file never
see them" on `/drive/tags`), which is reversible if the answer changes.
