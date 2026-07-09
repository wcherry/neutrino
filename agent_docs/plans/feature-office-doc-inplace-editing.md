# Plan: In-Place Editing of MS Office Docs (Issue #43)

Branch: `feature/office-doc-inplace-editing`
Status: approved by user in prior interactive planning session (architecture is final — native round-trip default, convert-on-open opt-in, all 3 formats, backend-minimal). This document is the saved record of that approved plan plus verification notes from a pre-implementation code check.

## What is changing and why

Today a raw `.docx`/`.xlsx`/`.pptx` uploaded to Drive is an opaque blob — clicking it opens a "Preview not available" modal. The only path to edit content is the existing manual Import feature, which creates a **separate, brand-new** native Neutrino document; the original uploaded file is untouched and orphaned.

This feature lets users open a raw Office file directly into the matching Neutrino editor (Docs/Sheets/Slides) and edit it in place, with two modes selectable in Settings:
- **Native round-trip (default)** — file stays real `.docx`/`.xlsx`/`.pptx` at rest forever; every save re-serializes back into genuine Office bytes as a new version of the *same* Drive file (same id/name/mime type).
- **Convert on open (opt-in)** — first open silently promotes the file into a normal native Neutrino doc/sheet/slide (same file id, mime type flipped); behaves like any other Neutrino document from then on.

Scope: Word, Excel, PowerPoint in one pass. Modern OOXML only — no legacy `.doc`/`.xls`/`.ppt`.

## Why this is low backend risk

The generic Drive content endpoints (`GET /files/{id}`, `PUT /files/{id}/autosave`, `POST /files/{id}/versions`) are mime-agnostic — pure `files.id` + bytes, zero dependency on `docs`/`sheets`/`slides` rows. Confirmed in code:
- `src/drive/storage/api.rs` — `autosave_file` (605), `save_version` (698), `list_versions`/`get_version`/`restore_version`/`download_version` (818-986) all operate generically.
- `src/drive/storage/repository.rs:195` `update_file_content` and `src/drive/storage/service.rs` callers (222, 358) confirm the version-snapshot-then-overwrite pattern used for named saves — no app-specific coupling.

So **native round-trip needs no backend changes** — frontend-only, reusing existing conversion code (`mammoth`, `docx` package, `xlsx`, `pptxImport.ts`/`pptxExport.ts`) already used for manual Import/Export. **Convert-on-open** needs one small, contained backend addition (a `promote` endpoint per app + one new repository/service/drive-client method), modeled closely on the existing rename flow.

## Layers affected

- **Backend (Rust)**: `promote` endpoint + DTOs for docs/sheets/slides; `update_file_mime_type` plumbing through storage repository → storage service → `DriveClient` (mirrors the existing `update_file_name` chain: `src/shared/drive_client.rs:200` → `src/drive/filesystem/repository.rs:189`, except mime type lives with content concerns so the new method goes in `src/drive/storage/{repository,service}.rs` next to `update_file_content` and is called from `DriveClient` alongside its existing `self.storage.*` calls, e.g. `find_file_any_user`/`autosave` at drive_client.rs ~190-225).
- **Frontend**: new `officeFormats.ts` helper; Drive routing dispatch (3 call sites, extracted to one `routeForFile` helper); office-mode detection + load/save path in `DocEditor.tsx`, `sheets/editor/hooks/usePersistence.ts`, `SlideEditor.tsx`; new binary-safe `*Bytes` wrapper functions in `api-drive/src/client.ts`; new "Drive" settings tab; new `useOfficeFileMode` hook.
- **Feature flag**: new DB-backed flag `officeInPlaceEditing` (migration `00098_admin__..._add_office_inplace_editing_flag`, disabled by default), consistent with recent precedent (`diagramsApp`, `docsDistractionFree`, `sheetsConditionalFormatting`) for a change of this surface area (Drive routing + 3 editors). Gates: Drive's office-file routing into the editor, each editor's office-mode detection/load/save path, and the Settings "Drive" tab. Backend `promote` routes exist unconditionally (small, inert unless called) — same pattern as other flagged features where the backend surface pre-exists the frontend gate coming down.
- **Tests**: Vitest unit test for `officeAppForFile`; component-level tests for office-mode load/save in each editor and the new Drive routing helper; Playwright E2E specs for round-trip and convert-on-open flows, with new binary fixtures.

## Specialists needed

- `rust-developer` — `update_file_mime_type` chain, per-app `promote` service method + route + DTO, migration for the feature flag.
- `frontend-developer` — `officeFormats.ts`, Drive routing refactor, office-mode logic in all 3 editors, `api-drive` binary wrappers, `useOfficeFileMode` hook, `promoteDoc`/`promoteSheet`/`promoteSlide` API wrappers, "Convert to Neutrino Doc" menu actions.
- `ui-designer` — new Settings "Drive" tab UI (reuse existing segmented-button pattern verified at Calendar's "Start of week", `settings/page.tsx` — exact line numbers to be re-confirmed by the agent since the file may have shifted).
- `test-writer` — unit test for `officeAppForFile`; Vitest tests for editor office-mode paths and routing helper; Playwright specs + binary fixtures (`sample.docx/.xlsx/.pptx`).

## Verified code anchors (confirmed against current `main` before implementation)

- `web/apps/web/src/app/(apps)/drive/page.tsx`: mimetype dispatch duplicated at `handleGridItemClick` (289-312), starred quick-access onClick (560-584), `FileContextMenu.onPreview` (685-704) — matches plan; `DOC_MIME`/`SHEET_MIME`/`SLIDES_MIME` consts at 99-101.
- `web/packages/api-core/src/client.ts:40-42` — `ApiClientError` has `statusCode`, confirmed.
- `DocEditor.tsx`: `getDoc` query at 718, `isLoading` gate at 1725, `buildDocxBlob` at 278, `handleImport`/mammoth at 1600-1607, `handleSaveAs` at 1621+.
- `web/apps/web/src/app/(apps)/drive/UploadZone.tsx:63` — confirmed `application/octet-stream` fallback for `entry.file.type`.
- Sheets: `useExport.ts` has `buildXlsxWorksheet` (42) and `doExportXlsx` (243); `SheetEditor.tsx` has the `XLSX.read` import path (85) and `handleImportSheet` (1396). Office-mode wiring in the plan targets `usePersistence.ts` for the metadata/content query + save-path integration; the actual XLSX read/write calls are re-exported/shared from `SheetEditor.tsx`/`useExport.ts` as today.
- `pptxImport.ts` / `pptxExport.ts` both exist under `slides/editor/`.
- Backend: `src/shared/drive_client.rs:200` `update_file_name`, delegates to `self.fs_repo.update_file(...)` (owner resolved via `self.storage.find_file_any_user` first) — the new `update_file_mime_type` follows the same "resolve owner, then mutate" shape but targets the storage repo/service (`update_file_content` pattern at `storage/repository.rs:195`, callers at `storage/service.rs:222,358`) since mime type is a content-lifecycle concern, not a filesystem-metadata one (name/folder/star, in `src/drive/filesystem/repository.rs:189`). `rust-developer` should treat this as the concrete implementation target, not a literal one-line mirror of `update_file_name`.
- `create_doc`/`create_sheet`/`create_slide` confirmed at `docs/docs/service.rs:52`, `sheets/sheets/service.rs:98`, `slides/slides/service.rs:78` — `promote` is modeled on these minus the "create new file" step.
- Feature flags are live and DB-backed (`FeatureFlagsProvider.tsx`, `flags.*` used throughout `SheetEditor.tsx`, `DocEditor.tsx`, `SlideEditor.tsx`); latest migration is `00097_admin__2026-06-15-000000_enable_drive_area_drop_target`, so the new flag migration is `00098_admin__2026-07-09-000000_add_office_inplace_editing_flag`.

## Risks / edge cases

- Binary corruption if any code path still uses the string-based `driveAutosaveContent`/`driveCreateVersion`/`TextEncoder` path for office bytes — mitigated by adding dedicated `*Bytes` sibling functions and only ever calling those from office-mode save paths (existing string-based functions untouched).
- 404-vs-not-found ambiguity when `docsApi.getDoc` 404s — must distinguish "raw office file, fall back to storage metadata" from "genuinely deleted/missing", per plan section 3.
- E2EE files: encrypted variants must call `encryptFile`/`decryptFile` directly on raw bytes, never round-trip through `TextEncoder`/`TextDecoder`.
- Permission edges: a viewer must get a clean 403 on attempted save/promote, not a corrupted write — verified manually per the plan's verification step 7.
- Promote sequence (`upload_content` → flip mime → insert app row) has a small inconsistency window if the mime-type flip fails after content upload succeeds — accepted per plan (explicit single-shot action, no 2PC in this pass).
- Legacy `.doc`/`.xls`/`.ppt` must NOT match `officeAppForFile` — regression risk is silently pulling legacy binary formats into a parser that can't read them.
- Out of scope, explicitly: Yjs presence/comments on office-mode files, perfect round-trip fidelity, 2PC safety net for promote, concurrent-edit conflict detection beyond existing last-write-wins.

## Acceptance criteria

1. Uploading a `.docx`/`.xlsx`/`.pptx` and clicking it (grid, starred, or context-menu preview) opens the matching editor, not the preview modal — only when `officeInPlaceEditing` flag is on.
2. Editing content and letting autosave fire, then reloading, preserves edits.
3. Downloading the raw file after edits opens as valid, uncorrupted OOXML in real Office/LibreOffice.
4. Named version save/restore works exactly as for native docs.
5. With "Convert on open" selected in Settings, opening a fresh office file silently promotes it (mime flips, Drive icon updates, subsequent opens are native).
6. The manual "Convert to Neutrino Doc/Sheet/Slide" menu action works as a one-shot regardless of the global setting.
7. Legacy `.doc`/`.xls`/`.ppt` files are unaffected — still fall through to today's preview/download modal.
8. A viewer (read-only collaborator) cannot corrupt the file via a save attempt — gets a clean permission error.
9. All of the above pass with `cargo test`, `pnpm test`, and the new Playwright specs green.

## Out of scope (explicit, per approved plan)

Real-time collaboration/comments on office-mode files; legacy binary Office formats; perfect round-trip fidelity (Word sections/margins, advanced cell formatting, PPT animations); 2PC for promote; autosave-cadence tuning; concurrent-edit conflict detection.
