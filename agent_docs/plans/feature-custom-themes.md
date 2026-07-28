# Custom Theme Creation and Editing — Implementation Plan

Branch: `feature/custom-themes`

## What is changing and why

Today the app-chrome theme system is a closed set of 9 presets (`light`, `dark`, `system`,
`glass`, `midnight`, `beach`, `forest`, `sunbeams`, `light-glass`) hardcoded into
`web/packages/tokens/src/colors.css` and the `ThemeChoice`/`ResolvedTheme` union types in
`ThemeProvider.tsx`. Users cannot create their own theme. This feature adds full CRUD for
user-defined "custom themes" (a name + ~24 canonical color tokens + light/dark base), stored
per-user in the backend, optionally shared publicly, and rendered at runtime via an injected
`<style>` tag — mirroring the existing `CustomFontsProvider` pattern — so no code deploy is
needed per theme and no closed TS union is required for custom theme IDs.

This also reconciles the Settings vs Profile page theme-picker duplication into one shared
component/hook, and standardizes on **auto-save on selection** (apply instantly + persist),
matching the Profile page's existing UX and the task's explicit requirement that "selecting
any theme … should apply instantly + persist".

## Layers affected

- **DB migration** (new `custom_themes` table)
- **Backend (Rust)** — new top-level `src/themes/` module: model, repository, service, dto, api
  (mirrors `src/slides/slides/*` theme code and `src/drive/fonts/*` module registration style)
- **Frontend API client** — new `@neutrino/api-themes` package (mirrors `@neutrino/api-slides` shape)
- **Frontend providers** — extend `ThemeProvider.tsx` types; new `CustomThemesProvider.tsx`
  (mirrors `CustomFontsProvider.tsx`); update `layout.tsx` anti-FOUC script + provider tree
- **Frontend UI** — new shared `ThemeGrid`/`useThemeSelection` (or similar) component + hook used
  by both `settings/page.tsx` (Appearance tab) and `profile/page.tsx`; new `ThemeEditorModal`
  (create/edit) and `AlertDialog`-based delete confirmation
- **Tests** — Vitest unit/component tests (ThemeProvider resolution, CustomThemesProvider style
  injection, shared theme-grid component, editor modal create/edit/delete flows) + Rust unit
  tests for repository ownership enforcement (own / public / other-user-private) and DTO
  validation (unknown token keys, malformed color values, ownership on PATCH/DELETE)

## Backend design

### Migration

New migration `migrations/00101_themes__2026-07-26-000000_create_custom_themes/` (next free
number after `00100`), with `up.sql` / `down.sql`:

```sql
CREATE TABLE custom_themes (
    id            TEXT PRIMARY KEY NOT NULL,
    user_id       TEXT NOT NULL,
    name          TEXT NOT NULL,
    is_public     INTEGER NOT NULL DEFAULT 0,   -- SQLite boolean convention (see slide_themes.is_system)
    color_scheme  TEXT NOT NULL,                -- 'light' | 'dark'
    tokens        TEXT NOT NULL,                -- serialized JSON object of the ~24 canonical tokens
                                                 -- (TEXT-blob-of-JSON precedent: user_profiles.social_links)
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_custom_themes_user_id ON custom_themes(user_id);
CREATE INDEX idx_custom_themes_is_public ON custom_themes(is_public);
```

No JSON column type precedent exists in this Diesel/SQLite codebase (checked `custom_fonts`,
`user_profiles.social_links`) — following `social_links`, `tokens` is a `Text` column holding a
serialized JSON string, (de)serialized in the service layer with `serde_json`.

### Rust module: `src/themes/`

New top-level module (sibling to `slides`, `drive`, `sheets` — not nested under an app, since
themes are a cross-app, user-owned resource; mirrors how `fonts` is a self-contained module
registered directly under `/api/v1` rather than nested under a single app's scope):

- `src/themes/mod.rs` — `pub mod model; pub mod repository; pub mod service; pub mod dto; pub mod api;`
- `src/themes/model.rs` — `CustomThemeRecord` (Queryable/Selectable), `NewCustomThemeRecord`
  (Insertable), `UpdateCustomThemeRecord` (AsChangeset) — structurally mirrors
  `src/slides/slides/model.rs` `ThemeRecord`/`NewThemeRecord`/`UpdateThemeRecord`.
- `src/themes/repository.rs` — `CustomThemesRepository` with:
  - `insert_theme(new_theme) -> CustomThemeRecord`
  - `list_visible_themes_for_user(user_id) -> Vec<CustomThemeRecord>` — `WHERE user_id = ? OR is_public = true`
    (mirrors `list_themes_for_user`'s `is_system OR user_id = ?` filter)
  - `get_theme(theme_id, user_id) -> CustomThemeRecord` — ownership-scoped lookup used before mutations
  - `update_theme(theme_id, user_id, changes)` — `WHERE id = ? AND user_id = ?`, 0 rows updated → `ApiError::not_found`
  - `delete_theme(theme_id, user_id)` — same ownership-scoped delete pattern
- `src/themes/dto.rs` — `CreateThemeRequest { name, color_scheme, tokens: HashMap<String, String>, is_public }`,
  `UpdateThemeRequest` (all fields `Option<...>`), `ThemeResponse` (includes `id`, `userId`,
  `isOwner` bool computed server-side, `isPublic`, `colorScheme`, `tokens`, `createdAt`, `updatedAt`),
  `ListThemesResponse { themes: Vec<ThemeResponse> }`. `#[serde(rename_all = "camelCase")]` throughout,
  matching `slides/slides/dto.rs` convention.
- `src/themes/service.rs` — `CustomThemesService`:
  - Validates `name` non-empty (trim), `color_scheme` is exactly `"light"` or `"dark"`.
  - **Token validation (security-critical)**: reject the request unless `tokens` contains only
    keys from a fixed allowlist (the ~24 canonical keys listed in the task — `--color-bg`,
    `--color-bg-subtle`, … `--color-info-subtle`) and every value matches a strict CSS-color
    regex (`^#[0-9a-fA-F]{3,8}$` or a small allowlisted `rgb()/rgba()` pattern) — no arbitrary
    strings, since these values are interpolated into a `<style>` tag on every page load.
    Unknown keys or malformed values → `ApiError::bad_request`.
  - `create_theme`, `update_theme`, `delete_theme` — ownership enforced by repository queries;
    service maps `NotFound` from repository straight through (repository already returns 404 for
    ownership mismatches, same as slides theme code — this doubles as leaking "theme doesn't
    exist" instead of "theme exists but isn't yours", which is fine/desired here since there's no
    sensitive existence signal to protect and it matches existing precedent).
  - `list_themes` returns own + public, with `is_owner` computed against `user.user_id` for the UI's
    edit/delete affordance.
- `src/themes/api.rs` — `ThemesApiState { service: Arc<CustomThemesService> }`, handlers:
  - `GET /themes` → `list_themes`
  - `POST /themes` → `create_theme`
  - `PATCH /themes/{id}` → `update_theme`
  - `DELETE /themes/{id}` → `delete_theme`
  - `configure(cfg)` registers all four (no literal-vs-parameterized ordering conflict since
    there's only one resource segment, but keep list/create before the `{id}` routes for
    consistency with the slides file's documented convention).
  - `ThemesApiDoc` (utoipa `OpenApi` derive) merged into main.rs's combined spec.

### Wiring into `src/main.rs`

- `mod themes;`
- Instantiate `ThemesRepository::new(pool.clone())` → `CustomThemesService::new(repo)` →
  `web::Data::new(themes::api::ThemesApiState { service })`, alongside the other per-module
  service construction blocks.
- `.app_data(themes_state.clone())`
- `.configure(themes::api::configure)` directly under the `/api/v1` scope (same level as
  `drive::fonts::api::configure_public`, not nested under `/admin` — themes are visible to any
  authenticated user, not admin-only).
- `doc.merge(themes::api::ThemesApiDoc::openapi());` in the combined OpenAPI spec.

No feature flag — per project policy, do not gate this behind a new flag.

## Frontend design

### New package `web/packages/api-themes`

Mirrors `@neutrino/api-slides`'s shape (`package.json`, `src/index.ts` re-exporting from
`src/client.ts` + `src/types.ts`, or a single `index.ts` like api-slides uses):

```ts
export interface CustomTheme {
  id: string;
  userId: string;
  name: string;
  isPublic: boolean;
  isOwner: boolean;
  colorScheme: 'light' | 'dark';
  tokens: Record<string, string>; // exact canonical token keys, values must match colors.css
  createdAt: string;
  updatedAt: string;
}
export interface CreateThemeRequest { name: string; colorScheme: 'light'|'dark'; tokens: Record<string,string>; isPublic: boolean; }
export interface UpdateThemeRequest { name?: string; colorScheme?: 'light'|'dark'; tokens?: Record<string,string>; isPublic?: boolean; }
export interface ListThemesResponse { themes: CustomTheme[]; }

export const themesApi = {
  listThemes(): Promise<ListThemesResponse>;
  createTheme(body: CreateThemeRequest): Promise<CustomTheme>;
  updateTheme(id: string, body: UpdateThemeRequest): Promise<CustomTheme>;
  deleteTheme(id: string): Promise<void>;
};
```

Token key names in `CustomTheme.tokens` **must exactly match** the CSS custom-property names in
`colors.css` (including the `--` prefix) — this is the contract the `<style>` generator in
`CustomThemesProvider` depends on. This is the #1 cross-layer consistency risk in this task —
verified explicitly at Step 5d.

### `ThemeProvider.tsx` changes

- `ThemeChoice` / `ResolvedTheme` become `KnownTheme | ` a template-literal/branded custom-id type,
  e.g. `type CustomThemeId = \`custom-${string}\`` unioned with the existing 9-name literal union
  (keeps autocomplete for built-ins, still accepts arbitrary custom IDs without widening to bare
  `string`).
- `VALID_CHOICES` check relaxes to: valid if it's one of the fixed presets OR matches
  `/^custom-/`. (We don't validate the custom ID actually exists client-side — a stale/deleted
  custom theme ID just resolves to a `data-theme` attribute with no matching `<style>` rule,
  which safely falls through to `:root` defaults with no visual break.)
- `resolveTheme('system')` behavior unchanged.
- `applyTheme` unchanged (still just `setAttribute('data-theme', resolved)`).

### `CustomThemesProvider.tsx` (new, mirrors `CustomFontsProvider.tsx`)

- On mount, calls `themesApi.listThemes()` (only if an access token exists, same guard as
  CustomFontsProvider) and injects/updates a `<style id="neutrino-custom-themes">` tag containing,
  per visible theme:
  ```css
  [data-theme="custom-<id>"] {
    color-scheme: <light|dark>;
    --color-bg: <value>;
    /* ...all ~24 canonical tokens... */
    /* mirrored aliases, generated the same way for every theme: */
    --color-text: var(--color-text-primary);
    --color-text-tertiary: var(--color-text-muted);
    --color-surface-secondary: <light-base: var(--color-neutral-100)-equivalent picked from the
       user's own bg/surface tokens, e.g. surface-raised — dark base mirrors dark preset's alias
       mapping (surface-secondary = surface-raised)>;
    --color-surface-past: <same source token as surface-secondary, per-base convention>;
    --color-surface-hover: var(--color-surface-raised);
    --color-primary: var(--color-accent);
    --color-primary-light: var(--color-accent-subtle);
  }
  ```
  Exact alias mirroring will follow the **dark** preset's mapping when `colorScheme === 'dark'`
  and the **light** preset's mapping when `colorScheme === 'light'` (light preset aliases
  `--color-surface-secondary` to a fixed neutral rather than `--color-surface-raised`; since custom
  themes have no neutral-50/100 scale, we substitute `--color-surface-raised` for both light and
  dark base — one consistent, simpler rule — noted as a deliberate simplification, not a bug).
- Exposes `useCustomThemes()` returning `{ themes, loaded }` for the Settings/Profile gallery UI.
- Values are inserted via `CSS.escape`/template-string with **no interpolation of anything but the
  already-validated hex/rgba strings from the trusted backend response** — defense in depth even
  though the backend already validates tokens (a compromised/legacy record should not become a CSS
  injection vector).

### `layout.tsx` wiring

- Add `<CustomThemesProvider>` to the provider tree, alongside `CustomFontsProvider` (order
  doesn't matter relative to `ThemeProvider` since it only injects a stylesheet keyed by
  `data-theme`, independent of which provider sets that attribute — but nest it inside
  `ThemeProvider` for consistency with `CustomFontsProvider`'s current placement).
- Anti-FOUC inline `<script>`: relax the `v.indexOf(t)<0` closed-list check to also accept
  `/^custom-/`, so a stored `custom-<uuid>` selection still gets applied pre-hydration (the
  `<style>` rule for it won't exist yet at this point since `CustomThemesProvider` hasn't fetched,
  but that's fine — same FOUC tradeoff as any other theme fetched async; worst case a flash of
  default styling until the injected stylesheet lands, no worse than today for a new tab).

### Shared theme-grid component/hook

New `apps/web/src/components/theme/ThemeGrid.tsx` (or `hooks/useThemeGrid.ts` + presentational
component — final split decided by `frontend-developer`), used by both `settings/page.tsx` and
`profile/page.tsx`:

- Renders the 9 built-in preset cards (existing `THEME_OPTIONS` data, moved into this shared
  module) **plus** a "Custom themes" section listing `useCustomThemes()` results as cards with a
  live swatch preview built from each theme's own `tokens` (not the CSS var, since the stylesheet
  might not have loaded yet — render swatches from the token data directly for instant preview).
  Cards for themes where `isOwner` is true show Edit/Delete icon buttons.
- A trailing "Create custom theme" card opens `ThemeEditorModal` in create mode.
- Selecting any card (built-in or custom) calls a single `onSelect(themeId)` callback that the
  parent wires to: `setTheme(id)` (apply instantly, from `useTheme()`) **and**
  `save.mutate({ theme: id })` (persist) — done synchronously in the click handler, not a
  `useEffect`, standardizing on this over both pages' previous divergent patterns (explicit Save
  button in Settings, auto-save-via-effect in Profile). This removes the "Save appearance" button
  from Settings' Appearance tab and the auto-save `useEffect` from Profile.

### `ThemeEditorModal.tsx` (new)

- `Modal` + `ModalHeader` + `ModalBody` + `ModalFooter`.
- `TextInput` for name.
- `RadioGroup` (or `Toggle`) for dark-base vs light-base — switching base re-seeds all color
  fields to that base preset's defaults *only if the user hasn't touched them yet* (avoid
  clobbering edits — track a `touched` flag per field, or simpler: only re-seed on initial base
  selection before any field edit).
- `Tabs`/`TabList`/`Tab`/`TabPanel` grouping the 24 fields into **Base** (7 fields) / **Text** (5
  fields) / **Accent** (4 fields) / **Status** (8 fields), each field rendered as a labeled
  `ColorPickerPopover` (`color`, `onChange`, `title=<label>`) — matches the trigger+popover pattern
  already used elsewhere for per-field color pickers, rather than raw `ColorPicker` which renders
  the full picker inline unprompted.
- Public/private `Toggle` ("Make this theme visible to everyone").
- Save → `themesApi.createTheme(...)` or `updateTheme(id, ...)`; on success, invalidate the
  themes query and close; `useToast` for success/error feedback.
- Cancel discards.

### Delete flow

- Delete icon on an owned card opens `AlertDialog` (never `window.confirm`) — "Delete theme
  '<name>'? This can't be undone." Confirm → `themesApi.deleteTheme(id)`; if the deleted theme was
  the user's currently-active theme, fall back to `'system'` (call `setTheme('system')` +
  `save.mutate({ theme: 'system' })`) so the UI never gets stuck on a `data-theme` value with no
  backing stylesheet rule and no visible option to change it back easily.

## Known risks / edge cases

1. **CSS injection via token values** — mitigated by strict server-side allowlist validation of
   keys + regex validation of color values (Step 2 of backend design); defense-in-depth on the
   frontend generator too.
2. **Token key drift** between `colors.css` canonical list, backend allowlist, and
   `@neutrino/api-themes` types — single source of truth will be a `CANONICAL_THEME_TOKENS`
   constant defined once in Rust (`src/themes/dto.rs` or a shared const) and mirrored exactly in a
   TS constant in `api-themes` — explicitly diffed against `colors.css` lines 17-56 before calling
   this done.
3. **Deleting the currently-selected theme** — handled by falling back to `'system'` (see above).
4. **Deleting/losing access to a public theme** someone else selected — their `data-theme` simply
   stops matching any injected rule and falls back to `:root` (light) defaults; no error state,
   documented as acceptable per task's `light-glass`-style graceful degradation precedent.
5. **Anti-FOUC script and custom themes** — first paint after choosing a custom theme may briefly
   show default styling until `CustomThemesProvider`'s fetch completes and injects the stylesheet;
   acceptable, same class of tradeoff as the existing system already has for anything async.
6. **`is_public` themes editable only by owner** — repository/service enforce this on PATCH/DELETE
   (own themes only, via the `WHERE user_id = ?` clause), even though `is_public` themes are
   *visible* to everyone via GET. Explicit test: user B can list but not edit/delete user A's
   public theme (expect 404).
7. **Sheets `Cell.tsx` hardcoded white/black** — untouched; no new theme CSS should ever target
   sheet cell rendering (already isolated since `Cell.tsx` doesn't use theme tokens).
8. **`user_profiles.theme` column** — no schema change; continues to store either a built-in
   preset name or `custom-<id>` string, validated nowhere server-side today (pre-existing, out of
   scope to fix here).

## Acceptance criteria

- [ ] Migration creates `custom_themes` table; `down.sql` drops it cleanly.
- [ ] `GET/POST /api/v1/themes` and `PATCH/DELETE /api/v1/themes/{id}` all function with ownership
      enforcement: owner can edit/delete own themes; non-owner gets 404 on PATCH/DELETE of
      someone else's theme (public or private); GET/list returns own (all) + others' public only.
- [ ] Token validation rejects unknown keys and non-color values with 400.
- [ ] `@neutrino/api-themes` types match Rust DTOs exactly (camelCase, field-for-field).
- [ ] Selecting a built-in or custom theme (Settings or Profile) applies it instantly and persists
      it via `save.mutate({ theme })`, consistently in both pages.
- [ ] Creating a custom theme via the editor modal round-trips: appears in the gallery, is
      selectable, and its `<style>` rule renders the chosen tokens under `[data-theme="custom-<id>"]`.
- [ ] Editing an owned theme updates its swatch/style live; editing someone else's theme is not
      possible from the UI (no Edit/Delete affordance shown when `isOwner` is false).
- [ ] Deleting an owned theme uses `AlertDialog`, never `window.confirm`.
- [ ] Deleting the currently-active custom theme falls back to `'system'` without a broken UI state.
- [ ] `Cell.tsx` hardcoded colors are unmodified.
- [ ] No new feature flag introduced.
- [ ] `pnpm lint`, `pnpm type-check`, relevant Vitest suites, and `cargo test` all pass.

## Specialist delegation plan

1. `test-writer` — Rust repository/service ownership + validation tests; Vitest tests for
   `ThemeProvider` (custom ID acceptance), `CustomThemesProvider` (style injection), shared
   theme-grid component (select/apply/persist), `ThemeEditorModal` (create/edit/validation),
   delete flow (`AlertDialog`, active-theme fallback). Written first (red phase).
2. `rust-developer` — migration, `src/themes/*`, `main.rs` wiring, `ThemesApiDoc`.
3. `frontend-developer` — `@neutrino/api-themes` package, `ThemeProvider.tsx` type changes,
   `CustomThemesProvider.tsx`, `layout.tsx` wiring, shared `ThemeGrid`, `ThemeEditorModal`,
   Settings/Profile page integration.
4. `ui-designer` — visual design of theme cards (swatch layout for a 24-token palette preview),
   editor modal layout/spacing within the Base/Text/Accent/Status tabs, empty/loading states for
   the custom-themes gallery.
