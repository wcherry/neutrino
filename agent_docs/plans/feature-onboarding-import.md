# Plan: Onboarding phase 4 — bulk import of local files and folders

Branch `feature/onboarding-import`, stacked on #281 (`feature/editor-shell-and-quick-access`).
Web app only. **No server change, no migration, no encryption wire-format change.**

## Summary

Let a user pick folders (or files, or drop folders) from their computer, scan them, see the
count and size per kind of file, choose a destination per kind, and import everything in the
background while they keep using the app. It is phase 4 of onboarding: the welcome wizard
(phase 3, built separately) embeds the component this ships in its "Bring your files" step, so
the component has a clean props API and no Drive-page assumptions.

## What exists and is reused (findings)

- **Background run**: `components/ImportRun/ImportRunProvider` already runs an import above the
  route (mounted in `(apps)/AppShellLayout.tsx`), sequences product-ignorant `ImportStep`s, shows
  a floating progress pill on every route but `/import`, registers `beforeunload`, supports
  Stop, and per-file **retry** (`retry(targets)` → each step re-run with an `only` set keyed by
  `ImportItem.file`), merging results (`mergeResults.ts`). The local import reuses it as is,
  with two additive generalisations:
  - `ImportPlan.archive` is typed as `ImportSource { close(): Promise<void> }` (a
    `TakeoutArchive` satisfies it); a local import passes a no-op source.
  - `ImportPlan.kind?: 'takeout' | 'local'` (default `'takeout'`), carried on running/done/failed
    state as `kind`, so `/import` and the import component can tell whose run it is.
  - For a `local` run, the pill also shows once the run is **done** (with counts and a
    dismiss ×), because the local import's result screen is not a page the user is on. Clicking
    the pill goes to `/import`, which renders the local run (progress or results with retry)
    through the same component instead of the Takeout stages.
- **Upload pipeline**: `uploadDriveFile(file, userId, { folderId, onProgress })` from
  `@/lib/api` / `@neutrino/api-drive` — DEK per file, sealed to the user's public key, encrypted
  metadata, on-device thumbnail; refuses with `MissingEncryptionKeyError` when the vault is locked.
  This is exactly what `UploadZone` uses. Reused unchanged. `canEncryptFor(userId)` is checked
  before the first write; no key → nothing written, summary `unencrypted: true` (Takeout rule).
- **Name collisions**: Drive uploads do nothing special — the server stores a second file with
  the same name beside the first. The import does the same for files. Folders are **reused** by
  name (case-insensitive), as the Takeout folder resolver does.
- **Folders**: `lib/takeout/folders.ts` `createFolderResolver()` — extended additively to take an
  optional base folder id and to cache **in-flight promises** (uploads run concurrently, and two
  files in a new folder must not create it twice).
- **Photos**: every Photos library item is a Drive image (the unfiltered library listing is
  `GET /drive/files?type=photo`, Drive-wide). The Photos app upload is `uploadEncryptedFile` +
  `photosApi.registerPhoto({ fileId, captureDate, metadata: { motionPhoto } })`, with
  `readMotionPhotoInfo` classifying Live/Motion photos while the bytes are plaintext. The import
  does the same after `uploadDriveFile`.
- **Office files**: a document *is* a `.docx` (issue #127): `routeForFile`/`officeAppForFile`
  open `.docx`/`.dotx` in Docs, `.xlsx` in Sheets, `.pptx` in Slides **directly, byte for byte —
  nothing is converted**. Legacy `.doc/.xls/.ppt` never open in an editor, so they are classified
  as "Everything else", not office.
- **Markdown**: a note *is* a `text/markdown` Drive file (`NOTE_MIME`); a `.md` uploaded to Drive
  opens in the note editor. Notes destination = upload byte for byte with mime `text/markdown`,
  then index it for search (`indexOnSave` + `extractNoteText`), like Keep import.
- **Quota**: `storageApi.getQuota()` → `QuotaInfo { usedBytes, quotaBytes | null,
  dailyUploadBytes, dailyCapBytes | null }`.
- **Dates**: Takeout runners call `applyImportMetadata` so imported files keep their dates; the
  local import does the same with `File.lastModified` (both dates) and `importSource` = the
  relative path.
- **Entry points**: `(apps)/NewItemFAB.tsx` is the New menu in both looks (`variant="topbar"`
  in Classic, `variant="sidebar"` in Flow/Blended). Account menu **Import → /import** is already
  wired in both shells (`AppShellLayout.tsx` `onImport`) — no change needed.

## Destinations (honest)

| Kind | Default | Options |
|---|---|---|
| Photos & videos | Photos and Drive | Photos and Drive · Don't import |
| Word, Excel, PowerPoint | Drive — opens in Docs, Sheets, Slides | that · Don't import |
| Markdown notes | Notes | Notes · Drive, as plain text files · Don't import |
| Everything else | Drive | Drive · Don't import |

Dropped: **Photos only** and **Drive only** for photos — every photo is a Drive file and every
Drive image is in the Photos library, so neither can be honoured. "Drive" for Markdown is offered
as **"Drive, as plain text files"** (mime `text/plain`), since a `text/markdown` file in Drive
is a note. Target Drive folder is user-picked (reusing `MoveFolderDialog` with new optional
`title`/`confirmLabel` props); chosen folders keep their structure under it.

## Module API (apps/web/src/lib/localImport/)

```ts
// classify.ts
export type ImportKind = 'media' | 'office' | 'markdown' | 'other';
export const IMPORT_KINDS: readonly ImportKind[]; // ['media','office','markdown','other']
export function classifyFile(name: string, mimeType: string): ImportKind;
/** The mime type to upload with: the browser's, or one inferred from the extension when the
 *  browser reported '' or application/octet-stream. */
export function mimeTypeFor(name: string, browserType: string): string;
/** OS clutter never imported: any path segment starting with '.', Thumbs.db, desktop.ini. */
export function isIgnoredPath(path: string): boolean;

// scan.ts
export interface PickedFile { file: File; path: string } // path: '/'-joined, relative, incl. top folder
export interface LocalImportFile extends PickedFile { kind: ImportKind; mimeType: string }
export interface KindTotals { count: number; bytes: number }
export interface ScanResult {
  files: LocalImportFile[]; totalBytes: number; byKind: Record<ImportKind, KindTotals>;
  ignored: number; roots: string[]; // top-level folder names (or [] for loose files)
}
export function scanFiles(picked: Iterable<PickedFile>): ScanResult;
export function pickedFromFileList(list: FileList | File[]): PickedFile[]; // webkitRelativePath || name
export async function pickedFromDataTransfer(dt: DataTransfer): Promise<PickedFile[]>; // walks directories

// destinations.ts
export type Destination = 'photos-drive' | 'drive' | 'notes' | 'drive-plain' | 'skip';
export type DestinationChoice = Record<ImportKind, Destination>;
export const DEFAULT_DESTINATIONS: DestinationChoice;
export const DESTINATION_OPTIONS: Record<ImportKind, { value: Destination; label: string }[]>;
export const KIND_LABELS: Record<ImportKind, string>;
export type ImportProduct = 'Photos' | 'Drive' | 'Notes';
export interface PlannedFile { source: LocalImportFile; product: ImportProduct; mimeType: string }
export function routeFiles(files: LocalImportFile[], choice: DestinationChoice): PlannedFile[]; // skips 'skip'
export function plannedBytes(planned: PlannedFile[]): number;

// quota.ts
export type QuotaCheck = { ok: true } | { ok: false; reason: 'quota' | 'daily'; neededBytes: number; availableBytes: number; message: string };
export function checkQuota(quota: QuotaInfo, bytes: number): QuotaCheck;

// pool.ts
export async function runPool<T>(items: readonly T[], limit: number,
  worker: (item: T, index: number) => Promise<void>, signal?: AbortSignal): Promise<void>;

// runLocalImport.ts
export const LOCAL_IMPORT_CONCURRENCY = 3;
export interface LocalImportDeps { upload; registerPhoto; readMotionPhotoInfo; applyImportMetadata;
  indexNote; canEncrypt; folderResolver } // injectable for tests; defaults to the real ones
export function runLocalImportStep(args: { product: ImportProduct; files: PlannedFile[];
  baseFolderId: string | null; userId: string | null | undefined; onProgress; signal; only?;
  concurrency?; deps?: Partial<LocalImportDeps> }): Promise<ImportSummary>;
export function buildLocalImportSteps(args: { planned: PlannedFile[]; baseFolderId: string | null;
  userId: string | null | undefined; deps?: Partial<LocalImportDeps> }): ImportStep[]; // Photos, Drive, Notes; empty ones omitted
```

`ImportItem.file` is the file's relative `path` (the retry key).

## Component (apps/web/src/components/LocalImport/)

- `useLocalImport(opts)` hook — scan state, destination choice, target folder, quota check, start.
- `<LocalImport />` — the reusable panel the wizard embeds (drop area with "Choose folders" /
  "Choose files", optional "From Google" Takeout card, scan summary with a destination select per
  kind, target folder, quota message, single **Import N files** button in the body, run status /
  result with retry). Props:
  ```ts
  interface LocalImportProps {
    defaultFolderId?: string | null;   // default null = My Drive
    defaultFolderName?: string;        // default 'My Drive'
    showTakeout?: boolean;             // default true: the "From Google" card linking to /import
    onStarted?: () => void;            // the run has been handed to the background
    className?: string;
  }
  ```
- `<LocalImportDialog open onClose folderId folderName />` — Drive's modal around it.

## Tasks

1. Generalise `ImportRunProvider` (source type, `kind`, done pill for local runs).
2. `lib/localImport/*` modules above; `folders.ts` base id + in-flight cache.
3. `useLocalImport`, `LocalImport`, `LocalImportDialog` + CSS modules (tokens, light/dark).
4. `NewItemFAB`: `Import folders` action (drive-only) → `drive:import-folders` event; Drive page
   opens `LocalImportDialog` for the current folder. `MoveFolderDialog` optional `title`/`confirmLabel`.
5. `/import`: render a `local` run through `<LocalImport />`.
6. Docs: `web/CLAUDE.md` section.

## Test plan

- Unit (vitest, `src/__tests__/localImport/`): classify, mimeTypeFor, ignore rules; scan totals
  and per-kind counts; destination defaults and routing (incl. skip and drive-plain); quota
  check (unlimited, fits, over quota, over daily cap); pool concurrency limit + abort; runner
  progress, per-file failure, retry `only`, unencrypted refusal, folder structure, photo
  registration, note indexing; component: scan summary renders counts, selects default, button
  label, quota block.
- E2E `e2e/tests/drive/local-import.spec.ts`: register, set up encryption, New › Import folders,
  set a fixture folder (photo, docx, md, txt in a subfolder) on the folder input, check counts,
  import, then assert via the API: photo registered in Photos, docx in Drive under the folder
  structure, md is a `text/markdown` note, txt in Drive.

## Risks

- Large imports: one file in memory per running upload (the existing pipeline reads a file to
  encrypt it); concurrency 3 bounds that. Files are `File` handles until uploaded.
- Retry after a reload is impossible (handles are gone) — same as Takeout; `beforeunload` warns.
- Encryption overhead is not counted in the quota pre-check (a few bytes per chunk).
