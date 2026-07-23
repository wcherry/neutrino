# Offline Mode for Docs + Sheets — Implementation Plan

Source spec: `/Users/williamcherry/.claude/plans/mutable-questing-kitten.md` (full detail there; this
file is the execution plan derived from it — branch, sequencing, delegation, risks, acceptance
criteria for this repo's dev workflow).

## What is changing and why

Docs and Sheets have no offline capability today: no service worker (static export build), no
local content cache, and no revision counter on the backend (autosave is last-write-wins with no
way to detect a conflicting concurrent edit). This adds:

1. A real `content_version` integer counter on `files`, bumped atomically on every autosave and
   named-version save, so client and server can agree on "has this changed since I last saw it."
2. A new `@neutrino/offline` package: an IndexedDB-backed, per-file opt-in cache of encrypted doc/
   sheet content (reusing the existing DEK/encrypt/decrypt path — never a second plaintext path).
3. A hand-rolled service worker + manifest so the app shell itself loads on a cold, fully offline
   launch (e.g. a `.webloc` bookmark opened with no network).
4. Editor integration in Sheets (`usePersistence.ts`) and Docs (`DocEditor.tsx`, inline) for load/
   save fallback to the local cache, plus a real "Make available offline" toggle (replacing
   Sheets' existing dead placeholder in `ExportDialogs.tsx`, and a new equivalent in Docs).
5. Shared offline/conflict status badges and a lightweight conflict-resolution dialog (keep mine /
   discard mine, plus a read-only plain-text/HTML preview of the server version — reusing existing
   `extractPlainText()` and the HTML-export serializer, not a new rich read-only render mode).

## Confirmed decisions (not open for reinterpretation — see source spec's Context section)

- Scope: **Docs + Sheets only**, not Slides.
- Offline availability is **per-file opt-in**.
- Conflict detection uses the **real `content_version` counter**, not a timestamp heuristic.
- No shortcut-generation feature — cold-load resilience only.
- Full **PWA app-shell caching** is in scope (without it, a cold offline launch can't even load
  the JS needed to check the local cache).
- **No feature-flag gating** — ships directly, no new `flags.*` entry.
- Conflict badge is clickable: "Keep my offline changes" / "Discard local changes and reload" +
  a read-only preview. No full diff/merge (future work).
- The per-file **DEK is cached locally** in IndexedDB next to the ciphertext, matching the
  existing Phase-1 E2E design's acceptance of local key material (master key already lives in
  plaintext `localStorage`).

## Layers affected

- **Backend (Rust)**: new migration `00100_drive__2026-07-19-000000_add_files_content_version`,
  `src/schema.rs`, `src/drive/storage/model.rs`, `src/drive/storage/repository.rs`,
  `src/drive/storage/dto.rs`. No handler signature changes needed (`service.rs`/`api.rs` already
  pass the DTO through).
- **Frontend contract**: `web/packages/api-drive/src/types.ts` (`FileItem.contentVersion`),
  `web/packages/api-drive/src/client.ts` (`driveAutosaveContent`/`driveAutosaveEncryptedContent`
  return `Promise<FileItem>` instead of discarding the body).
- **New package**: `web/packages/offline/` (`db.ts`, `cache.ts`, `useOnlineStatus.ts`, `index.ts`),
  added to `web/apps/web/next.config.ts`'s `transpilePackages`.
- **PWA shell**: `web/apps/web/public/manifest.json`, `web/apps/web/public/sw.js`,
  `web/apps/web/src/components/ServiceWorkerRegister.tsx`, registration wired into the root
  `web/apps/web/src/app/layout.tsx` (not the nested `(apps)/layout.tsx`).
- **Sheets**: `usePersistence.ts` (load/save fallback, cache write-through), `ExportDialogs.tsx`
  (real toggle replacing the coming-soon placeholder at ~line 480-491).
- **Docs**: `DocEditor.tsx` (inline load/save fallback in existing query/mutation, widened
  `saveStatus` union), `MenuBar.tsx` (new "Make available offline" item under `File`).
- **Shared UI**: new `web/apps/web/src/components/OfflineStatusBadge.tsx` on `@neutrino/ui`'s
  `Badge`; conflict resolution dialog + preview (reusing `DocComparePanel.tsx`'s
  `extractPlainText()` for Docs, existing HTML-export serialization for Sheets).
- **Tests**: Rust unit tests for the `content_version` increment; Vitest for `@neutrino/offline`'s
  `cache.ts` (via `fake-indexeddb`); Playwright e2e for the offline user journeys.

## Specialists needed

- `rust-developer` — §1 backend `content_version` work. Lands first; frontend typing depends on
  the real contract.
- `frontend-developer` — `@neutrino/offline` package, SW/manifest, frontend contract updates,
  Sheets integration, Docs integration, shared indicators, conflict dialog (multiple passes per
  the sequencing below).
- `test-writer` — coverage after each integration phase (Rust unit tests, Vitest for the offline
  package, Playwright e2e for the four Verification scenarios). No upfront red-phase — the source
  spec's own Delegation section calls for tests after each phase, which supersedes this workflow's
  default TDD-first step for this feature.

## Known risks and edge cases

- **Race-free revision increment**: must be a `.set((changeset, files::content_version.eq(...+1)))`
  DB-level expression, not a read-modify-write in application code, or two concurrent autosaves
  could both read the same starting value.
- **Network-failure vs. HTTP-error confusion**: `request()` in `api-core/client.ts` does not wrap
  `fetch()` in try/catch, so a real network failure throws a raw `TypeError`, not `ApiClientError`.
  Every fallback-to-cache branch must distinguish "genuinely offline" (fall back to cache) from
  "404/403/500" (real error, must not be masked) — getting this backwards would silently serve
  stale cached content when a file was actually deleted, or silently swallow real errors as if
  offline.
- **Never autosave after a failed load** (existing project lesson, applies again here): offline
  cache fallback must feed decrypted content through the same load pipeline so a failed load never
  starts an autosave/save-fallback interval against empty state — that would overwrite real
  content once connectivity returns.
- **DEK must come from the cache, not `dekRef.current`**, when serving offline — `dekRef` may
  itself have failed to resolve with no network.
- **SW must not cache `/api/*`** — the IndexedDB layer already owns revision-aware offline data
  handling; a second, uncoordinated SW-level cache of API responses would undermine conflict
  detection.
- **SW registration must be unconditional and pre-auth** — registering inside the `(apps)` layout's
  post-auth `useEffect` would defeat a cold offline launch (chicken-and-egg: can't reach the app
  shell to resolve auth without the SW already caching it).
- **Cache versioning on deploy** — the SW's cache name must be stamped with a real build id
  (short git SHA) at build time so every deploy invalidates the previous shell.
- **Store ciphertext, never plaintext**, in IndexedDB — reuse `encryptFile`/`decryptFile` exactly
  as the server-side path does, to avoid a second instance of the known "plaintext silently
  treated as corrupt" failure mode already documented for the E2E system.
- **`navigator.onLine` is a weak signal** (network-interface-present, not can-reach-server) — used
  only to drive the badge/reconnect check, never as the sole gate for falling back to cache.
- **Conflict badge false positives**: must only show when the server is ahead of the cached
  revision AND the cache has a local dirty edit (`cached.dirty === true`). Server-ahead with no
  local dirty edit means silently refresh the cache — nothing to lose, nothing to show.
- **`DocEditor.tsx` is 2451 lines** with persistence interleaved with office-mode branches and Yjs
  collab — integrate inline into the existing `queryFn`s/`onError`, do not attempt a
  `useDocsPersistence.ts` extraction in this pass (real refactor, separate follow-up).
- **No new "flush on reconnect" trigger needed** beyond the existing 3s Sheets `timedSave` and
  Docs' mutation retry, which already re-attempt once `dirty`/`unsaved` state is set from a prior
  failure. The one genuinely new listener is the `online`-event revision check driving the
  conflict badge.

## Acceptance criteria (mirrors source spec's Verification section)

- `cargo test` passes, including new tests proving: sequential autosaves each bump
  `content_version` by exactly 1; `save_named_version` also bumps it.
- `pnpm vitest` passes, including new tests for `@neutrino/offline`'s `cache.ts` get/put/dirty-
  outbox semantics (via `fake-indexeddb`).
- Manual/e2e (Playwright, `page.setOffline(true)`):
  a. Opt a doc and a sheet into offline mode, hard-reload while offline → app shell loads, cached
     content still visible.
  b. Edit while offline → edit is queued (pending outbox), not lost.
  c. Reconnect → queued edit flushes, offline badge clears.
  d. Edit the same file from a second session while the first is offline, reconnect the first →
     conflict badge appears with a working preview + keep/discard resolution.

## Sequencing (from source spec, followed as-is)

1. Backend `content_version` (§1) — `rust-developer`.
2. `@neutrino/offline` package (§2) + frontend contract updates — `frontend-developer`, parallel
   to step 1 for the package itself (contract types trail the real backend contract).
3. Service worker + manifest (§3) — `frontend-developer`, independent, parallel to 1 and 2.
4. Sheets integration (§4 Sheets) — `frontend-developer`, after 1-3 land (needs real
   `contentVersion` typing + the offline package).
5. Docs integration (§4 Docs) — `frontend-developer`, ports the validated Sheets pattern.
6. Shared UI indicators (§5) — depends on `isOfflineCacheServed`/conflict-state plumbing from 4/5.
7. Conflict resolution dialog + preview (§6) — fast-follow once badges are visible and correct.

Test coverage lands after each phase per the source spec's Delegation section. Single feature
branch (`feature/offline-mode-docs-sheets`), single PR at the end; commits follow phase
boundaries.
