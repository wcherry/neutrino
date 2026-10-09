# Plan: Self-contained uploads for photo sync (Phase 1, backend)

## Summary
Drive iOS photo sync moves about one photo per wake-up because each photo needs four sequential
requests, and the key `PUT` and date `PATCH` need the app awake after the body lands
(neutrino_drive_ios_mobile#38). This change lets `POST /api/v1/drive/files/upload` carry the
uploader's sealed file key and the file's dates, written in the same transaction as the file
row, so one background upload is complete on its own. Full analysis:
`neutrino_drive_ios_mobile/agent_docs/research/2026-10-09-photo-sync-latency.md`.

## Affected Repos
- neutrino — additive multipart fields on the upload endpoint; no migration.
- neutrino_drive_ios_mobile — research doc now; the Phase 1 client drain refactor follows on the
  same branch name.

## Tasks
1. `storage/model.rs` — `UploadExtras`, `UploadFileKey`, `UploadStamp`.
2. `storage/repository.rs` — `insert_uploaded_file` (file row + dates + `file_key_refs` row in one
   `IMMEDIATE` transaction) and `public_key_version_exists`.
3. `storage/service.rs` — `validate_upload_extras`; `finalize_upload` takes `UploadExtras`.
4. `storage/api.rs` — parse `encrypted_file_key`, `key_version`, `created_at`, `updated_at`,
   `import_source`; validate before streaming the body.

## Decisions
- `key_version` may be any version in `user_public_keys` for the uploader, retired included;
  an unpublished one is a 400 `UNKNOWN_KEY_VERSION`. Missing defaults to 1, as on `PUT /key`.
- Dates are accepted from every client and do not require `import_source`. `import_source`
  additionally sets `imported_at` = now.
- Text fields must precede the file part, as for the existing fields.

## Test Plan
- Unit: `storage::service::tests::an_upload_*` — active, retired and unpublished key versions,
  empty key, dates with and without `import_source`, no extras.
- E2E: `e2e/tests/drive/self-contained-upload.spec.ts` (API-level).
