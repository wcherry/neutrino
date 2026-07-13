# Plan: Admin-managed custom font upload, available in every editor

Branch: `feature/custom-fonts`

## Why

Font handling today is 100% hardcoded (`FONT_FAMILIES` / `FONT_FAMILY_NAMES` in
`web/apps/web/src/constants/editor.ts`), duplicated per editor, and only 5 of the
~12 listed fonts are actually loaded as web fonts (fixed Google Fonts `<link>` in
`layout.tsx`). There is no way for an admin to add a font without a code change
and a redeploy. This feature lets admins upload font files (woff2/woff/ttf/otf)
that immediately become selectable in Docs, Slides, Sheets, Drawing, and
Diagrams, mirroring the existing `feature_flags` admin-managed global config
pattern.

## What's changing

### Backend (Rust) — new `drive::fonts` module

**Migration** `migrations/00099_admin__2026-07-12-000000_create_custom_fonts/`
(next number after `00098_admin__...office_inplace_editing_flag`, `admin__`
prefix per the feature-flags/admin convention):

```sql
-- up.sql
CREATE TABLE custom_fonts (
    id                TEXT PRIMARY KEY NOT NULL,
    display_name      TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    format            TEXT NOT NULL,   -- 'woff2' | 'woff' | 'ttf' | 'otf'
    storage_key       TEXT NOT NULL,   -- resolved via LocalFileStore
    uploaded_by       TEXT NOT NULL,   -- user id
    created_at        TEXT NOT NULL
);
```
```sql
-- down.sql
DROP TABLE IF EXISTS custom_fonts;
```

Add the `custom_fonts` `table!` block and an entry in
`allow_tables_to_appear_in_same_query!` at the bottom of `src/schema.rs`
(same place `feature_flags` was added).

**New module** `src/drive/fonts/{mod.rs, model.rs, repository.rs, service.rs, api.rs}`
— same shape as `src/drive/feature_flags/*`:

- `model.rs`: `CustomFontRecord` (`Queryable`/`Selectable` on `custom_fonts`).
- `repository.rs`: `FontsRepository::{list, insert, delete, find_by_id}` — same
  `DbPool` + `ApiError` conventions as `FeatureFlagsRepository`.
- `service.rs`: `FontsService` wraps `FontsRepository` + the **existing**
  `Arc<LocalFileStore>` (created once in `main.rs`, already shared across
  Drive/Docs/etc. — do not create a second store). Font bytes are written via
  `store.file_path("fonts", &format!("{id}.{ext}"))`, reusing
  `LocalFileStore`'s existing per-partition path scheme with `"fonts"` as the
  partition key instead of a user id (there's no per-user scoping for fonts).
  Service owns validation: allowed formats `woff2`/`woff`/`ttf`/`otf` checked
  against both the file extension and sniffed/declared MIME type, 50 MB max
  size enforced while streaming to the temp file (abort + cleanup temp file
  over limit, same pattern as `upload_file` in `drive/storage/api.rs`).
- `api.rs`: `FontsApiState { service: Arc<FontsService> }`, handlers:
  - `GET /fonts` — any authenticated user (`AuthenticatedUser` extractor, the
    same one `drive/storage/api.rs` uses — **not** `AdminUser`). Returns each
    font's id, display name, format, and a `fileUrl` pointing at
    `/api/v1/fonts/{id}/file`. Registered via `configure_public`.
  - `GET /fonts/{id}/file` — also `AuthenticatedUser`-gated (not a bare public
    static route — see frontend section below for why an auth-gated route is
    still usable for `@font-face`). Serves bytes via `NamedFile`
    (`store.resolve_for_serving`, mirroring `download_file`'s NamedFile setup)
    with `Content-Type` set from the stored `format` (`font/woff2`,
    `font/woff`, `font/ttf`, `font/otf`). Registered via `configure_public`.
  - `POST /admin/fonts` — `AdminUser`-gated, `Multipart` (fields: `file`,
    `display_name`), same streaming-to-temp-file pattern as
    `drive/storage/api.rs::upload_file`. Registered via `configure_admin`.
  - `DELETE /admin/fonts/{id}` — `AdminUser`-gated, deletes DB row + file on
    disk. Registered via `configure_admin`.
  - Include a `FontsApiDoc` (`utoipa::OpenApi`) following the
    `FeatureFlagsApiDoc` shape; merge into `main.rs`'s combined OpenAPI doc.

**`main.rs` wiring** (mirrors feature-flags wiring exactly):
- Build `Arc<FontsRepository::new(pool.clone()))>` and
  `Arc<FontsService::new(fonts_repo, file_store.clone()))>` near the existing
  `file_store` construction (~line 267) so we reuse the same `LocalFileStore`
  instance already built for Drive.
- `let drive_fonts_state = web::Data::new(drive::fonts::api::FontsApiState { service: ... });`
  `.app_data(drive_fonts_state.clone())` alongside `drive_feature_flags_state`.
- Inside `web::scope("/api/v1")`: `.configure(drive::fonts::api::configure_public)`
  next to `.configure(drive::feature_flags::api::configure_public)`.
- Inside the nested `web::scope("/admin")`: `.configure(drive::fonts::api::configure_admin)`
  next to `.configure(drive::feature_flags::api::configure_admin)`.
- Merge `FontsApiDoc::openapi()` into the combined `doc` next to the
  feature-flags merge (~line 829/845).

### Frontend

**`@neutrino/api-admin`** (`web/packages/api-admin/src/`):
- `types.ts`: add `FontFormat = 'woff2' | 'woff' | 'ttf' | 'otf'` and
  `CustomFont { id: string; displayName: string; format: FontFormat; fileUrl: string; uploadedBy: string; createdAt: string }`
  (camelCase, mirrors `serde(rename_all = "camelCase")` like `FeatureFlag`).
- `client.ts`: add a `fontsApi` export alongside `adminApi` (list call needs
  only authenticated-user access, not admin, so it's kept separate from
  `adminApi` which is all admin-gated):
  - `fontsApi.list(): Promise<CustomFont[]>` → `GET /api/v1/fonts` via `request()`.
  - `fontsApi.getFileBlob(fileUrl): Promise<Blob>` → `request(fileUrl, {}, { responseType: 'blob' })`
    (the `request()` helper already supports `responseType: 'blob'` per
    `RequestConfig` in `api-core/src/client.ts`).
  - `adminApi.uploadFont(file: File, displayName: string): Promise<CustomFont>`
    → `POST /api/v1/admin/fonts`, multipart (mirrors `storageApi.uploadFile`'s
    `FormData` construction in `api-drive/src/client.ts`).
  - `adminApi.deleteFont(id: string): Promise<void>` → `DELETE /api/v1/admin/fonts/{id}`.
- `index.ts`: re-export the new types + `fontsApi`.

**Why the font-file route stays authenticated instead of becoming a bare
public static route:** browsers loading `@font-face { src: url(...) }` do not
attach our `Authorization` bearer header (it lives in `localStorage`, not a
cookie). Rather than inventing a second, unauthenticated file-serving
mechanism, `CustomFontsProvider` fetches each font's bytes as a `Blob` through
the existing authenticated `request()` client, creates an `object URL`, and
points the injected `@font-face` `src` at that object URL. This keeps the new
routes consistent with every other authenticated endpoint in the codebase and
avoids a second auth model.

**`web/apps/web/src/providers/CustomFontsProvider.tsx`** (new, mirrors
`FeatureFlagsProvider.tsx`):
- On mount (guarded on `localStorage.getItem('access_token')` being present,
  so it doesn't fire — and force a 401 → redirect — on `/sign-in`), calls
  `fontsApi.list()`, then for each font calls `fontsApi.getFileBlob(font.fileUrl)`,
  builds one `@font-face` rule per font pointing at `URL.createObjectURL(blob)`,
  and injects them all into a single `<style id="neutrino-custom-fonts">` tag
  appended to `document.head` (created once, contents replaced on refetch).
- Exposes `useCustomFonts()` → `{ fonts: CustomFont[]; loaded: boolean }` via
  context, same `loaded` flag convention as `useFeatureFlagsLoaded()`.
- Mounted in `web/apps/web/src/app/layout.tsx` next to `FeatureFlagsProvider`
  (order doesn't matter for correctness since token is read from
  `localStorage` directly, not from `AuthProvider` context — but the plan is
  to nest it inside `FeatureFlagsProvider` to keep provider order left-to-right
  visually grouped with the other app-wide singletons).

**`web/apps/web/src/hooks/useAvailableFonts.ts`** (new):
- Merges built-ins (`FONT_FAMILIES`, `FONT_FAMILY_NAMES` from
  `constants/editor.ts`) with `useCustomFonts().fonts`, returning:
  - `fontFamilies` — CSS-stack form (built-ins + one entry per custom font,
    e.g. `{ label: displayName, value: "'<displayName>', sans-serif" }`), for
    Docs/Sheets which bind directly to a CSS `font-family` value.
  - `fontFamilyNames` — bare-name form (built-ins + custom), for Slides.
  - `customFontFamilies` / `customFontFamilyNames` — the custom-only subsets,
    for editors (Drawing) that maintain their own bespoke built-in list and
    just want to append custom fonts rather than fully replace their list.
  - `loaded` — passthrough of `useCustomFonts().loaded`.

**Wire into editors** (replace direct `FONT_FAMILIES`/`FONT_FAMILY_NAMES`
imports with the hook):
- Docs `web/apps/web/src/app/(apps)/docs/editor/Toolbar.tsx` (~line 355-368):
  `const { fontFamilies } = useAvailableFonts()`, map over it instead of the
  imported `FONT_FAMILIES` constant.
- Slides `web/apps/web/src/app/(apps)/slides/editor/SlideEditor.tsx`
  (~line 80, 1394-1395): replace the `FONT_FAMILY_NAMES as FONT_FAMILIES`
  import with `const { fontFamilyNames } = useAvailableFonts()`.
- Sheets `web/apps/web/src/app/(apps)/sheets/editor/StyleToolbar.tsx`
  (~line 17, 127-133): same swap to `fontFamilies`.
- Drawing `web/apps/web/src/app/(apps)/drawing/editor/StylePanel.tsx`
  (~line 82, 243-247): keep its existing bespoke `FONT_FAMILIES` array
  (it includes generic `sans-serif`/`serif`/`monospace` entries the others
  don't) and append `customFontFamilies` from the hook to it.
- Diagrams `web/apps/web/src/app/(apps)/diagrams/editor/PropertiesPanel.tsx`
  (`ShapeProperties`, ~line 67-176): the `ShapeStyle`/`ConnectorStyle` types
  (`web/apps/web/src/app/(apps)/diagrams/types.ts` ~line 92-98, 155-162)
  **already have a `fontFamily: string` field** — `shapeUtils.ts` (~line 306,
  320) just hardcodes it to `'Inter'` at shape-creation time and no UI ever
  edits it afterward. Add a `<select className={styles.select}>` font-family
  control to `ShapeProperties` right next to the existing "Font size" row
  (~line 161-173), bound to `style.fontFamily`, calling
  `onUpdate({ style: { ...style, fontFamily: e.target.value } })`, populated
  from `useAvailableFonts().fontFamilyNames` (bare-name form, same as
  Slides, since `ShapeStyle.fontFamily` is a bare name rendered directly as
  `font-family` on the canvas text, matching how `'Inter'` is used today).
  Also add the same control to `MultiShapeProperties` (~line 277-309) for
  bulk-editing multiple selected shapes' font, mirroring how Fill/Stroke are
  already bulk-editable there. `ConnectorProperties` (~line 182-271) has a
  `fontFamily` on `ConnectorStyle` too, but there's no font-size/font-family
  UI at all today for connector labels — introducing net-new connector text
  styling UI is out of scope; only the shape-properties panel gets the new
  control, per the task instruction to target "the property panel that
  currently has no font UI at all" for shapes specifically.

**Admin page** `web/apps/web/src/app/(apps)/admin/page.tsx`:
- Add `'fonts'` to the `Tab` union and `TABS` array.
- New `FontsTab()` component, modeled directly on `FeatureFlagsTab()`
  (~line 452-521): `useQuery(['admin-fonts'], () => fontsApi.list())` for the
  list; a `DropZone` (from `@neutrino/ui`) + a display-name text input +
  upload button driving a `useMutation` calling `adminApi.uploadFont(file, displayName)`,
  invalidating `['admin-fonts']` on success (and surfacing errors — bad
  format/too large — via the existing `useToast()` pattern the tab already
  uses); each row shows display name, format badge, uploaded date, and a
  delete button wired to `adminApi.deleteFont(id)`.
- **Known limitation, consistent with existing `FeatureFlagsTab`/
  `FeatureFlagsProvider` behavior**: uploading/deleting a font from the admin
  panel updates the admin tab's own list immediately (react-query
  invalidation) but does **not** live-push into `CustomFontsProvider`'s
  already-fetched, already-mounted `@font-face` styles elsewhere in the app —
  a refresh is needed for other open tabs/sessions to see it. This exactly
  mirrors how toggling a feature flag in `FeatureFlagsTab` doesn't live-update
  `FeatureFlagsProvider` elsewhere either.

## Layers touched

- Backend (Rust): migration, new `drive::fonts` module, `main.rs` wiring.
- Frontend: `@neutrino/api-admin` client + types, new provider, new hook,
  5 editor pickers (Docs, Slides, Sheets, Drawing, Diagrams), admin page.
- Design: no new visual system needed — `FontsTab` reuses existing admin page
  section styles (`styles.section`, `styles.serviceList`, `styles.serviceRow`,
  etc.) and `DropZone` as-is. `ui-designer` involvement should be light —
  only needed if the upload form (name input + DropZone + submit) needs a new
  small layout treatment beyond what those existing styles provide.
- Tests: backend unit/integration tests for the new module (mirroring
  `feature_flags/api.rs`'s `#[cfg(test)] mod tests`), frontend unit tests for
  `useAvailableFonts`, `CustomFontsProvider`, and each edited editor's font
  picker, plus an E2E covering admin upload → font appears in a Docs (and
  ideally Slides) font picker.

## Risks / edge cases

- **Auth timing**: `CustomFontsProvider` must not fire (and trigger a 401 →
  redirect loop) on `/sign-in`/`/register` before a token exists — guard on
  `access_token` presence in `localStorage`, matching `getAuthHeader()`'s own
  null-checks in `api-core/src/client.ts`.
- **Object URL cleanup**: revoke previously created object URLs before
  replacing the `<style>` tag's contents on refetch, to avoid leaking blob
  URLs if the provider ever refetches (it currently fetches once on mount,
  matching `FeatureFlagsProvider`, but keep the cleanup path correct/future-proof).
- **Duplicate font names**: no uniqueness constraint requested/implied by the
  existing `feature_flags` pattern (which uses `key` as a natural primary
  key, but font display names are arbitrary) — allow duplicates; `id` (uuid)
  is the real primary key. Note this rather than silently rejecting.
- **Malformed font files**: extension/mime allow-list is necessary but not
  sufficient (a renamed `.txt` could pass the `.ttf` extension check) —
  service-level validation should check both extension and sniffed mime type
  the same way `drive/storage/api.rs` already resolves `mime_guess`; a
  corrupt-but-correctly-extensioned file will simply fail to render as a font
  client-side, which is an acceptable failure mode (same as any other
  user-uploaded asset in Drive).
- **50 MB limit**: enforced server-side while streaming (abort + delete temp
  file over limit) — do not trust a client-side check alone.
- **Diagrams connector labels**: only the shape-properties font control is in
  scope (see above); connector label font styling has no existing UI and
  stays out of scope to avoid inventing net-new connector text UI.

## Acceptance criteria

- [ ] Migration creates `custom_fonts`; `schema.rs` updated; `cargo test` passes.
- [ ] `GET /api/v1/fonts` (any authenticated user) lists uploaded fonts with a
      working `fileUrl`.
- [ ] `GET /api/v1/fonts/{id}/file` serves correct bytes with correct
      `Content-Type` per format, requires authentication.
- [ ] `POST /api/v1/admin/fonts` — admin-only; rejects disallowed
      extensions/mime types and files over 50 MB; non-admin gets 403,
      unauthenticated gets 401 (mirroring feature-flags admin route tests).
- [ ] `DELETE /api/v1/admin/fonts/{id}` — admin-only, removes DB row and file.
- [ ] Uploading a font in `/admin` → Fonts tab makes it selectable (after a
      refresh) in Docs, Slides, Sheets, Drawing, and Diagrams (shape
      properties) font pickers, and text actually renders in that font.
- [ ] Deleting a font removes it from the admin list and the DB/disk file.
- [ ] Existing built-in fonts still work unchanged in all five editors.
- [ ] All new backend and frontend tests pass; full existing suite still passes.
