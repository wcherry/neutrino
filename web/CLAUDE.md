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

**API clients** — `apps/web/src/lib/api.ts` re-exports everything from all `@neutrino/api-*` packages so existing code can import from `@/lib/api`. New code should import directly from the specific package (e.g. `@neutrino/api-calendar`).

**State management** — TanStack Query (`@tanstack/react-query`) for all server state. Zustand is available but used sparingly. Local UI state uses `useState`/`useReducer`.

**Feature flags** — flags are stored in the database and served by `GET /api/v1/feature-flags`. The `FeatureFlags` type in `apps/web/src/lib/featureFlags.ts` lists all known flags for TypeScript type-safety; `FeatureFlagsProvider` fetches the live values on mount. Toggle flags at runtime via the admin panel (`/admin`) or `PATCH /api/v1/admin/feature-flags/{key}`. To add a new flag: add it to the `FeatureFlags` type, add an `INSERT` in a new migration under `migrations/`, and register it via the admin API or directly in the DB.

**User preferences** — persisted in `localStorage` and read back on mount with a `storage` event listener for cross-tab sync. The pattern is used for theme (`neutrino.theme`), calendar week start (`neutrino:calendar:weekStart`), and similar settings. Preferences are not stored in the backend unless they are part of `UpdateProfileRequest` (handled by `authApi.updateProfileDetails`).

**Calendar app** — `apps/web/src/app/(apps)/calendar/page.tsx` is the main client component. It owns all state: current view (`month` | `week` | `agenda`), cursor date, event/reminder CRUD mutations, ICS drag-and-drop, and browser notifications. View components (`MonthView`, `WeekView`, `AgendaView`) are pure presentational and receive `cursor`, `events`, `onDayClick`, `onEventClick`, and `startDay` props. Helper functions (`eventsForDay`, `weekStartDate`, `expandRecurringEvents`, etc.) are in `calendarHelpers.ts`. Constants (day/month names, reminder presets) are in `calendarConstants.ts`.

**Settings** — the `/settings` page (`apps/web/src/app/(apps)/settings/page.tsx`) is tab-based. The Calendar tab stores the `weekStart` preference in localStorage via `WEEK_START_KEY`. The calendar page listens to the `storage` event to pick up changes without a page reload. The settings page itself is gated by `featureFlags.settingsPage`.

**UI library** — `@neutrino/ui` exports primitives (Button, Text, Heading, Badge, Avatar), inputs (TextInput, Select, Checkbox, Radio, Toggle, SearchInput), feedback (Alert, Toast/ToastProvider, Spinner, Skeleton, EmptyState, ProgressBar), containers (Card, Modal, Panel, Popover, Drawer, Tabs, Accordion), and navigation (Menu, Dropdown, Breadcrumbs, Pagination). CSS is CSS Modules with `var(--color-*)` design tokens.

**Back navigation pattern** — pages that need a back button (profile, users, docs templates, etc.) use a raw `<button>` with a `backBtn` CSS Module class alongside `<ArrowLeft size={16} />` from lucide-react and `router.back()` from `useRouter`. The `backBtn` style is transparent, `font-size: 13px`, `color: var(--color-text-secondary)`, and turns `var(--color-primary)` on hover. It sits above the `<h1>` heading inside the `.header` div.

**Tests** — Vitest + Testing Library + jsdom. Config is at the repo root (`vitest.config.ts`). Tests live alongside or under `src/__tests__/` inside each app/package. The `@` alias resolves to `apps/web/src`. API modules are always mocked with `vi.mock` — no real HTTP calls in tests.

**Sheets editor** — `apps/web/src/app/(apps)/sheets/editor/`. Key architecture:
- `SheetEditor.tsx` — top-level component owning all state (currentCell, selectionAnchor/selectionActive, data Map, colWidths/rowHeights). Keyboard shortcuts are registered via `document.addEventListener('keydown', ...)` in `useEffect` with empty deps; handlers read state from stable refs updated every render, so the effect never needs to be re-registered.
- `SheetGrid.tsx` — virtualised grid (prefix-sum viewport culling). Selection overlay is an absolutely-positioned `div` with an inline border, not a CSS class. Cell elements have `id={cellId}` for direct DOM access.
- `Cell.tsx` — pure presentational; `.cell` has hardcoded `background-color: #ffffff` and `color: #000000` that must never be overridden by theme CSS (user cell fill colours applied via inline `cellStyle`). `.cellSelected` adds a tinted overlay on top.
- Hooks under `hooks/`: `useCellEditing`, `useHistory`, `useClipboard`, `useSheets`, `usePersistence`, `useExport`. `useCellEditing` owns formula bar state, formula pick mode, style application, and merge/unmerge.
- Cell IDs are spreadsheet addresses: `A1`, `B3`, `AA10`. `alphaToNum`/`numToAlpha` in `utils.ts` convert between column letters and 1-based integers.
- Dark mode: the app root sets `data-theme="dark"`. CSS Modules require `:global([data-theme="dark"]) .localClass` to target ancestor-attribute dark overrides within a module file. The grid header and cell backgrounds are hardcoded light colours intentionally — do not add dark-mode overrides for them.
