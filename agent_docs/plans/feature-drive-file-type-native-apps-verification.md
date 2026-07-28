# Manual Verification: Native app kinds for DriveFileType

## Prerequisites
- [ ] A logged-in user with at least one file each of: a photo (image/*),
      a Doc, a Sheet, a Slide, a Diagram, a Drawing, and a Note. The easiest
      way to get one of each native type is to create one file per app from
      the Drive "New" menu (Docs, Sheets, Slides, Diagrams, Drawing, Notes).
- [ ] `cargo run` (or however the backend is normally started locally) with
      a fresh/seeded SQLite DB.
- [ ] API access via `curl` with a valid bearer token, or Postman/similar.

## Steps to Verify

### Happy path — each native type is filterable
1. Create one file in each of Docs, Sheets, Slides, Diagrams, Drawing, and
   Notes (via their respective "New" flows in the web app).
2. Call `GET /api/v1/drive?type=doc` with the user's bearer token. Confirm
   only the Docs file is returned in `files`.
3. Repeat for `type=sheet`, `type=slide`, `type=diagram`, `type=drawing`,
   `type=note` — each should return only the matching file, and no others
   (in particular, files from a *different* native app must not leak in).
4. Confirm the existing `type=photo`, `type=video`, `type=audio`,
   `type=document` filters still behave exactly as before (unaffected by
   this change) — e.g. `type=document` should still return PDFs/text files
   but not any of the native app files (their MIME types are
   `application/x-neutrino-*`, not `application/vnd.*`/`application/pdf`/etc).
5. Call `GET /api/v1/drive` with no `type` param at all — confirm all files
   (native and generic) still show up in the normal unfiltered listing,
   unaffected by this change.

### Edge Cases
1. Call `GET /api/v1/drive?type=bogus` (an invalid/unknown value) — confirm
   this still returns the same error/behavior it did before this change
   (deserialization failure), not a silent fallback.
2. Trash a Doc file, then call `GET /api/v1/drive?type=doc` — confirm the
   trashed file is excluded (matches existing trash-exclusion behavior for
   the other types).
3. As a second user, create a Doc file. Call `GET /api/v1/drive?type=doc`
   as the first user — confirm the second user's file is not returned
   (scoped to the requesting user, matching existing per-user scoping).
4. If the app was promoted from a raw Office upload (e.g. an uploaded
   `.docx` promoted into a native Sheets/Docs file via the "open in
   Neutrino" flow), confirm it now carries the native
   `application/x-neutrino-*` MIME type (not the transient
   `OFFICE_MIME_TYPE`/`XLSX_MIME`/etc. constant) and is picked up correctly
   by its native `type=` filter, exactly like a file created directly in
   the app.
5. Check the OpenAPI docs UI (e.g. `/swagger-ui` or wherever this repo
   serves it) for the `GET /api/v1/drive` endpoint's `type` query param —
   confirm the description now lists all 10 values:
   `photo | video | audio | document | doc | sheet | slide | diagram |
   drawing | note`.

## Expected Results
- Each native app's files are filterable by their own dedicated `type=`
  value and are never returned under another native type or under the
  generic `document` bucket.
- The 4 pre-existing type filters (`photo`/`video`/`audio`/`document`)
  behave identically to before this change.
- No UI change is expected — there is currently no filter dropdown wired
  up in the Drive UI that sets this query param; this is a backend +
  type-mirror-only change.

## Known pre-existing gap (not part of this change, flagged only)
- Notes files (`application/x-neutrino-note`) are not yet mapped in
  `web/apps/web/src/app/(apps)/drive/routeForFile.ts` or
  `web/apps/web/src/lib/file-icons.ts`'s per-app MIME maps, so opening a
  Notes file from the Drive grid currently falls through to a generic
  preview instead of a dedicated Notes route/icon. This is unrelated to
  `DriveFileType` and was intentionally left untouched — separate follow-up
  needed if desired.
