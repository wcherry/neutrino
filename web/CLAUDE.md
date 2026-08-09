# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev           # Start all apps in development mode (Turborepo)
pnpm build         # Build all apps and packages
pnpm lint          # Lint all packages
pnpm type-check    # TypeScript check across all packages
pnpm test          # Run all tests (Vitest, run-once)
pnpm test:watch    # Run tests in watch mode

# Run a single test file
pnpm vitest run apps/web/src/__tests__/calendar/EventDetail.test.tsx
```

## Architecture

**Monorepo layout** — Turborepo + pnpm workspaces.

```
apps/web/          # Next.js 15 app (App Router) — all user-facing routes
packages/
  api-*            # One thin API client per backend service (calendar, core, docs, etc.)
  ui/              # Shared component library (Button, Modal, Toast, Select, etc.)
  tokens/          # Design tokens (CSS variables, imported via packages/ui/src/styles/)
  layout/          # Shell components (Topbar, Sidebar) — moved out of @neutrino/ui
  hooks/           # Shared React hooks
  auth/            # Auth API client + useAuth hook
  e2e-crypto/      # End-to-end encryption helpers
  utils/           # Shared utilities
```

**App Router structure** — all user-facing routes live under `apps/web/src/app/(apps)/`. The `(apps)` route group shares a common shell layout (`layout.tsx`). Individual apps (calendar, docs, drive, notes, photos, sheets, slides, settings) each have their own route directory there.

**Sidebar navigation** — the sections live in `apps/web/src/app/(apps)/navSections.ts`, not in `layout.tsx`, so they can be unit-tested (`src/__tests__/navSections.test.ts`) without rendering the shell. The first (unlabelled) section holds Drive views only; every application sits under the **Apps** header; then Team, per-tag entries (`lib/tagNav.ts`), and Administration for admins. `withActiveItem` marks the entry whose href is the longest prefix match for the current pathname, so `/docs/editor` keeps Docs highlighted while `/drive/trash` highlights Trash rather than My Drive. Adding an app means adding an entry here, a landing page, and a row in `e2e/tests/navigation/sidebar.spec.ts`.

**Office Suite landing pages** — `/docs`, `/sheets`, `/slides` and `/drawing` are thin wrappers over `apps/web/src/app/(apps)/DocumentLibrary.tsx`, which owns the whole listing experience: the `FileGrid`, create button, empty state, right-click menu (Preview / Rename / Copy link / Move to trash) and rename dialog. Each page supplies only its labels, icon, editor path, React Query key and four callbacks (`fetchItems`, `createItem`, `renameItem`, `deleteItem`); deletes go through `storageApi.deleteFile` for all of them since these are Drive files. `previewKind` is what `DocumentPreviewModal` renders — omit it (as `/drawing` does) and the Preview item disappears. `/notes`, `/photos` and `/diagrams` predate this component and still have hand-written pages.

**Drive views** — My Drive (`drive/page.tsx`), Recent, Starred, Shared with me, Trash and the tag pages all render `FileGrid` from `@neutrino/ui`, which owns the Large grid / Small grid / Detailed list selector, the filter chips and the sort bar. `drive/gridItems.ts` holds the domain → `GridItem` mappings (`fileToGridItem`, `folderToGridItem`, `trashFileToGridItem`, `trashFolderToGridItem`) so every surface shows the same icon, subtitle and star state. My Drive sorts server-side via the query key; the other views have no sort parameters on their endpoints and sort client-side with `sortEntries`. Trash rows carry `deletedAt` instead of `updatedAt`, so it is mapped onto the Modified column, and Restore / Delete forever live in the row's three-dot menu (`trash/TrashContextMenu.tsx`). Folders are not addressable by URL — My Drive tracks the open folder in component state — so clicking a folder outside My Drive does nothing.

**API clients** — `apps/web/src/lib/api.ts` re-exports everything from all `@neutrino/api-*` packages so existing code can import from `@/lib/api`. New code should import directly from the specific package (e.g. `@neutrino/api-calendar`).

**State management** — TanStack Query (`@tanstack/react-query`) for all server state. Zustand is available but used sparingly. Local UI state uses `useState`/`useReducer`.

**Feature flags** — flags are stored in the database and served by `GET /api/v1/feature-flags`. The `FeatureFlags` type in `apps/web/src/lib/featureFlags.ts` lists all known flags for TypeScript type-safety; `FeatureFlagsProvider` fetches the live values on mount. Toggle flags at runtime via the admin panel (`/admin`) or `PATCH /api/v1/admin/feature-flags/{key}`. To add a new flag: add it to the `FeatureFlags` type, add an `INSERT` in a new migration under `migrations/`, and register it via the admin API or directly in the DB.

**User preferences** — persisted in `localStorage` and read back on mount with a `storage` event listener for cross-tab sync. The pattern is used for theme (`neutrino.theme`), calendar week start (`neutrino:calendar:weekStart`), and similar settings. Preferences are not stored in the backend unless they are part of `UpdateProfileRequest` (handled by `authApi.updateProfileDetails`).

**Calendar app** — `apps/web/src/app/(apps)/calendar/page.tsx` is the main client component. It owns all state: current view (`month` | `week` | `agenda`), cursor date, event/reminder CRUD mutations, ICS drag-and-drop, and browser notifications. View components (`MonthView`, `WeekView`, `AgendaView`) are pure presentational and receive `cursor`, `events`, `onDayClick`, `onEventClick`, and `startDay` props. Helper functions (`eventsForDay`, `weekStartDate`, `expandRecurringEvents`, etc.) are in `calendarHelpers.ts`. Constants (day/month names, reminder presets) are in `calendarConstants.ts`.

**Settings** — the `/settings` page (`apps/web/src/app/(apps)/settings/page.tsx`) is tab-based. The Calendar tab stores the `weekStart` preference in localStorage via `WEEK_START_KEY`. The calendar page listens to the `storage` event to pick up changes without a page reload. The settings page itself is gated by `featureFlags.settingsPage`.

**UI library** — `@neutrino/ui` exports primitives (Button, Text, Heading, Badge, Avatar), inputs (TextInput, Select, Checkbox, Radio, Toggle, SearchInput), feedback (Alert, Toast/ToastProvider, Spinner, Skeleton, EmptyState, ProgressBar), containers (Card, Modal, Panel, Popover, Drawer, Tabs, Accordion), and navigation (Menu, Dropdown, Breadcrumbs, Pagination). CSS is CSS Modules with `var(--color-*)` design tokens.

**Back navigation pattern** — pages that need a back button (profile, users, docs templates, etc.) use a raw `<button>` with a `backBtn` CSS Module class alongside `<ArrowLeft size={16} />` from lucide-react and `router.back()` from `useRouter`. The `backBtn` style is transparent, `font-size: 13px`, `color: var(--color-text-secondary)`, and turns `var(--color-primary)` on hover. It sits above the `<h1>` heading inside the `.header` div.

**Tests** — Vitest + Testing Library + jsdom. Config is at the repo root (`vitest.config.ts`). Tests live alongside or under `src/__tests__/` inside each app/package. The `@` alias resolves to `apps/web/src`. API modules are always mocked with `vi.mock` — no real HTTP calls in tests.

**Google Takeout import** — `/import` (`apps/web/src/app/(apps)/import/page.tsx`), reached from the Topbar user menu below Settings (`onImport` on `Topbar`, wired in `(apps)/layout.tsx`). Everything runs client-side in `apps/web/src/lib/takeout/`: `archive.ts` opens the zip and groups entries by product directory (the `Takeout/` wrapper is detected by shape, not by name, so localised exports work), and each product then has a converter plus a runner.

`archive.ts` reads with **zip.js, not JSZip** (which the app still uses elsewhere, e.g. the pptx importer). This is the one thing to preserve if that module is ever rewritten: a Takeout export runs to gigabytes, and JSZip's `loadAsync` reads the whole file into an `ArrayBuffer` before it can list it, which capped the feature at what a tab could allocate — to import documents that are a rounding error beside the photos in the same archive. zip.js's `BlobReader` seeks with `Blob.slice`, so opening reads only the central directory at the tail (~64 KB whatever the archive size) and each `text()`/`blob()` inflates one entry, in a worker. Peak memory is the largest file, not the archive; `archive.test.ts` pins both properties down by counting bytes sliced. The reader stays open for the archive's life, so the page closes it on reset and on unmount. The import cannot live on the server: note and document content is E2EE, so only the browser holds the DEK — each runner mints one per item and registers it with `encryptionApi.setFileKey`, exactly as an editor's first save does. Two products are supported and the page runs them in sequence, sharing one progress bar and one result screen (`types.ts` holds the `ImportSummary`/`ImportItem` shape both report in, `folders.ts` the cached folder-path resolver both use).

- **Keep → Notes** — `inlineHtml.ts` turns Keep's HTML into the editor's inline markdown, `keep.ts` converts a note into `Block[]`, `importKeep.ts` drives the run.
- **Drive → Docs** — a Google Doc is a Drive file, so it lands in `Takeout/Drive/` as `.docx` (the export default), `.html` or `.txt`; `driveDocs.ts` picks those out of everything else in the export, `docHtml.ts` converts HTML into the editor's Tiptap JSON by hand (rather than through `DocEditor`'s extension list, which would pull the editor into the import bundle — so it emits only nodes every feature-flag configuration understands), and `importDocs.ts` drives the run, mirroring the export's folder tree via `folders.ts`. Formats the browser can't convert (`.pdf`, `.odt`, `.rtf`) are counted and reported rather than silently missing.

To add a product, add a converter module plus a runner returning an `ImportSummary`, and a section in the page.

Every stage logs to the console through `log.ts` (`[takeout:archive]`, `[takeout:keep]`, `[takeout:docs]`, `[takeout:folders]`, `[takeout:page]`) — an import is a long unattended run over files we didn't write, so the console is the only record of which file failed and where. `describeError` turns an API rejection into `HTTP <status> <code>: <message>`, and both runners use it for the reason shown against a failed item, so a 413 or an expired session is legible on the result screen rather than arriving as a bare message. Logging is unconditional: the failure has already happened by the time anyone would think to turn a debug flag on.

**Notes live updates** — the note editor (`apps/web/src/app/(apps)/notes/editor/page.tsx`) stays in sync with edits made by another user or another device. `useFileSync` (`apps/web/src/hooks/useFileSync.ts`) opens a relay socket at `/api/v1/files/{id}/ws` — the shared, file-type-agnostic endpoint (backend: `src/shared/file_events/`, backed by the same generic `PresenceRoom` sheets and slides use for their own separate sockets; notes is its only caller so far). The relay carries a *signal* only — `{ clientId }`, never file content — because notes are E2EE; on receiving one the editor invalidates the `['note', id]` / `['note-content', id]` queries and decrypts the fresh content locally. A local autosave broadcasts the signal after the PATCH succeeds. Guards in the editor: `dirtyRef`/`savingRef` stop an incoming revision from overwriting unsaved keystrokes (local autosave stays last-write-wins), `editSeqRef` keeps that protection alive for keystrokes typed while a save was in flight, and `appliedUpdatedAtRef` records the revision on screen so our own saves never trigger a re-read. While the socket is down the metadata query polls every 15 s as a fallback (`refetchInterval: connected ? false : OFFLINE_POLL_MS`).

**Search index changes** — nothing is searched server-side: the topbar drop-down, the Drive search view (`/drive?q=…`) and `/search` all read one IndexedDB index (`packages/search`) that every app writes to — editors on save (`lib/searchIndexUpdate.ts`), the periodic sync (`lib/searchIndexer.ts`), and the cross-device snapshot exchange (`lib/searchIndexSnapshot.ts`). Because those readers hold their hits in component state, the write paths announce themselves through `packages/search/src/events.ts`: `IndexEngine`, `clearSearchIndex` and `importSnapshot` call `emitSearchIndexUpdate`, and readers subscribe with `useSearchIndexUpdates` (`apps/web/src/hooks/`) to re-run their query. Emit from the write path itself, after the write lands, so a new way of touching the index can't forget to notify and no listener re-reads too early. Updates are coalesced over 250 ms (a rebuild writes one document at a time) and carried to other tabs over a `BroadcastChannel` — the index is shared storage, so a save in the Docs tab changes what the Drive tab would return with no code running there. "Reload the index" means re-query: the entries are already in IndexedDB by the time the event fires. Cross-*device* notification is a different mechanism — the encrypted snapshot, pulled on app start and tab focus.

**Sheets editor** — `apps/web/src/app/(apps)/sheets/editor/`. Key architecture:
- `SheetEditor.tsx` — top-level component owning all state (currentCell, selectionAnchor/selectionActive, data Map, colWidths/rowHeights). Keyboard shortcuts are registered via `document.addEventListener('keydown', ...)` in `useEffect` with empty deps; handlers read state from stable refs updated every render, so the effect never needs to be re-registered.
- `SheetGrid.tsx` — virtualised grid (prefix-sum viewport culling). Selection overlay is an absolutely-positioned `div` with an inline border, not a CSS class. Cell elements have `id={cellId}` for direct DOM access.
- `Cell.tsx` — pure presentational; `.cell` has hardcoded `background-color: #ffffff` and `color: #000000` that must never be overridden by theme CSS (user cell fill colours applied via inline `cellStyle`). `.cellSelected` adds a tinted overlay on top.
- Hooks under `hooks/`: `useCellEditing`, `useHistory`, `useClipboard`, `useSheets`, `usePersistence`, `useExport`. `useCellEditing` owns formula bar state, formula pick mode, style application, and merge/unmerge.
- Cell IDs are spreadsheet addresses: `A1`, `B3`, `AA10`. `alphaToNum`/`numToAlpha` in `utils.ts` convert between column letters and 1-based integers.
- Dark mode: the app root sets `data-theme="dark"`. CSS Modules require `:global([data-theme="dark"]) .localClass` to target ancestor-attribute dark overrides within a module file. The grid header and cell backgrounds are hardcoded light colours intentionally — do not add dark-mode overrides for them.
