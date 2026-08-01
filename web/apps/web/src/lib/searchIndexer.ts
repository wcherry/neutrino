/**
 * Collection and maintenance of the client-side search index.
 *
 * The index lives in IndexedDB (`@neutrino/search`) and is the only thing the
 * search box queries — nothing is searched server-side. It therefore has to be
 * populated for search to return anything, which is what `syncSearchIndex`
 * does on app start; `rebuildSearchIndex` is the heavier "throw it away and
 * start over" path exposed in Settings → Advanced.
 */

import {
  clearSearchIndex,
  IndexEngine,
  type SearchableDocType,
  type SearchableDocument,
} from '@neutrino/search';
import {
  calendarApi,
  diagramsApi,
  docsApi,
  drawingApi,
  extractDiagramText,
  extractDocText,
  extractDrawingText,
  extractNoteText,
  extractSheetText,
  extractSlideText,
  notesApi,
  sheetsApi,
  slidesApi,
  storageApi,
  type FileItem,
} from '@/lib/api';
import { readDocumentText } from '@/lib/documentContent';
import {
  DIAGRAM_MIME,
  DOC_MIME,
  DRAWING_MIME,
  NOTE_MIME,
  SHEET_MIME,
  SLIDES_MIME,
} from '@/app/(apps)/drive/routeForFile';

/**
 * One indexable item. `id`/`type`/`title`/`updatedAt` come from the cheap
 * listing endpoints; `load()` is the expensive part (fetching and decrypting
 * the body) and is only called for items that actually need re-indexing.
 */
export interface IndexJob {
  id: string;
  type: SearchableDocType;
  title: string;
  updatedAt: number;
  load: () => Promise<SearchableDocument>;
}

export interface SyncProgress {
  done: number;
  total: number;
}

export interface SyncResult {
  /** Items fetched and written to the index. */
  indexed: number;
  /** Index entries dropped because the item no longer exists server-side. */
  removed: number;
  /** Items that were already up to date. */
  skipped: number;
}

const SYNC_INTERVAL_MS = 5 * 60_000;
const LAST_SYNC_KEY_PREFIX = 'neutrino:search:lastSync:';

/**
 * Bumped whenever a fix changes what gets *stored* for an item, as opposed to
 * which items are stored. The incremental sync trusts `updatedAt` and skips
 * anything the server hasn't touched since, so without this an index built by
 * older code stays wrong forever — the documents look current and are never
 * re-read.
 *
 * v2: bodies are decrypted before indexing. Every doc/sheet/slide/note built by
 * v1 holds its title and nothing else, because the ciphertext it tried to parse
 * as JSON always failed and was indexed as empty content.
 *
 * v3: documents saved with the `docsLayoutStructure` flag on store their Tiptap
 * JSON inside a `{ doc, _meta }` wrapper. v2 walked the wrapper itself, found no
 * nodes, and indexed those documents as empty too.
 *
 * v4: terms are stored as plain text instead of HMACs, so prefix queries can
 * range over them. The IndexedDB upgrade drops the old stores outright — the
 * hashes cannot be turned back into terms — so this pass refills them.
 */
const CONTENT_VERSION = 4;
const CONTENT_VERSION_KEY_PREFIX = 'neutrino:search:contentVersion:';

const DRIVE_PAGE_SIZE = 200;
const DRIVE_MAX_PAGES = 5;

/**
 * A doc/sheet/slide/note/diagram/drawing *is* a Drive file with the same id,
 * and its own app already indexes it with full text. Skipping those mimetypes
 * here stops the name-only Drive pass from overwriting a richer entry.
 */
const APP_OWNED_MIMES = new Set([
  DOC_MIME,
  SHEET_MIME,
  SLIDES_MIME,
  NOTE_MIME,
  DIAGRAM_MIME,
  DRAWING_MIME,
]);

function toMillis(iso: string): number {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** Drive files, paged, with a hard cap so a huge drive can't stall the sync. */
async function listDriveFiles(): Promise<FileItem[]> {
  const files: FileItem[] = [];
  for (let page = 0; page < DRIVE_MAX_PAGES; page++) {
    const res = await storageApi.listFiles({
      limit: DRIVE_PAGE_SIZE,
      offset: page * DRIVE_PAGE_SIZE,
    });
    files.push(...res.items);
    if (res.items.length < DRIVE_PAGE_SIZE) break;
  }
  return files;
}

/** The cheap listing every content app exposes: enough to decide what to load. */
interface DocumentMeta {
  id: string;
  title: string;
  updatedAt: string;
}

/**
 * One app whose documents carry indexable text.
 *
 * All six store an E2EE body under their Drive file id, so they differ only in
 * how they list their documents and how their stored JSON flattens to text.
 * Adding an app here is all it takes for its content to become searchable.
 */
interface DocumentSource {
  type: SearchableDocType;
  list: () => Promise<DocumentMeta[]>;
  /** Stored (decrypted) body -> searchable plain text. */
  extract: (raw: string) => string;
}

const DOCUMENT_SOURCES: DocumentSource[] = [
  { type: 'note', list: async () => (await notesApi.listNotes()).notes, extract: extractNoteText },
  { type: 'document', list: async () => (await docsApi.listDocs()).docs, extract: extractDocText },
  { type: 'spreadsheet', list: async () => (await sheetsApi.listSheets()).sheets, extract: extractSheetText },
  { type: 'slide', list: async () => (await slidesApi.listSlides()).slides, extract: extractSlideText },
  { type: 'diagram', list: async () => (await diagramsApi.listDiagrams()).diagrams, extract: extractDiagramText },
  { type: 'drawing', list: async () => (await drawingApi.listDrawings()).drawings, extract: extractDrawingText },
];

/**
 * Every indexable item across the apps that feed search. Listing failures for
 * one content type are non-fatal — the rest of the index still gets built.
 */
export async function collectIndexJobs(userId: string): Promise<IndexJob[]> {
  const [contentLists, [eventsRes, remindersRes, driveFiles]] = await Promise.all([
    Promise.allSettled(DOCUMENT_SOURCES.map((source) => source.list())),
    Promise.allSettled([
      calendarApi.listEvents(),
      calendarApi.listReminders(),
      listDriveFiles(),
    ] as const),
  ]);

  const jobs: IndexJob[] = [];

  DOCUMENT_SOURCES.forEach((source, i) => {
    const listed = contentLists[i];
    if (listed.status !== 'fulfilled') return;
    for (const item of listed.value) {
      const updatedAt = toMillis(item.updatedAt);
      jobs.push({
        id: item.id,
        type: source.type,
        title: item.title,
        updatedAt,
        load: async () => ({
          id: item.id,
          type: source.type,
          title: item.title,
          content: source.extract(await readDocumentText(userId, item.id)),
          updatedAt,
        }),
      });
    }
  });

  if (eventsRes.status === 'fulfilled') {
    for (const e of eventsRes.value.events) {
      jobs.push({
        id: e.id,
        type: 'event',
        title: e.title,
        updatedAt: toMillis(e.updatedAt),
        load: async () => ({
          id: e.id,
          type: 'event',
          title: e.title,
          content: e.description ?? '',
          updatedAt: toMillis(e.updatedAt),
        }),
      });
    }
  }

  if (driveFiles.status === 'fulfilled') {
    for (const f of driveFiles.value) {
      if (APP_OWNED_MIMES.has(f.mimeType)) continue;
      jobs.push({
        id: f.id,
        type: 'file',
        title: f.name,
        updatedAt: toMillis(f.updatedAt),
        load: async () => ({
          id: f.id,
          type: 'file',
          title: f.name,
          // File bodies are encrypted blobs; the name is all we can index.
          content: '',
          updatedAt: toMillis(f.updatedAt),
          mimeType: f.mimeType,
        }),
      });
    }
  }

  if (remindersRes.status === 'fulfilled') {
    for (const r of remindersRes.value.reminders) {
      jobs.push({
        id: r.id,
        type: 'reminder',
        title: r.title,
        updatedAt: toMillis(r.updatedAt),
        load: async () => ({
          id: r.id,
          type: 'reminder',
          title: r.title,
          content: '',
          updatedAt: toMillis(r.updatedAt),
        }),
      });
    }
  }

  return jobs;
}

/**
 * Wipe the index and re-index everything. Individual failures are skipped so a
 * single unreadable document can't abort the run.
 */
export async function rebuildSearchIndex(
  userId: string,
  onProgress?: (progress: SyncProgress) => void,
): Promise<number> {
  await clearSearchIndex();

  const jobs = await collectIndexJobs(userId);
  const total = jobs.length;
  onProgress?.({ done: 0, total });
  if (total === 0) return 0;

  const engine = new IndexEngine();

  for (let i = 0; i < jobs.length; i++) {
    try {
      await engine.indexDocument(await jobs[i].load());
    } catch {
      // Skip individual failures — a partial index beats no index.
    }
    onProgress?.({ done: i + 1, total });
  }

  markSynced(userId);
  return total;
}

/**
 * Bring the index in line with the server without re-fetching bodies that
 * haven't changed: items whose `updatedAt` (or title) already matches the
 * stored entry are left alone, and entries for deleted items are dropped.
 */
export async function syncSearchIndex(userId: string): Promise<SyncResult> {
  const engine = new IndexEngine();

  const [jobs, existing] = await Promise.all([collectIndexJobs(userId), engine.listDocuments()]);

  // An index written by an older version holds the wrong *content* for items
  // the server considers unchanged, so this one run has to re-read everything.
  const stale = storedContentVersion(userId) < CONTENT_VERSION;

  const liveIds = new Set(jobs.map((j) => j.id));
  let indexed = 0;
  let skipped = 0;
  let removed = 0;

  for (const job of jobs) {
    const entry = existing.get(job.id);
    // A stored title of `''` means the entry predates title storage, so it
    // still needs a pass even when the timestamps line up.
    const upToDate = !stale && entry && entry.updatedAt >= job.updatedAt && Boolean(entry.title);
    if (upToDate) {
      skipped++;
      continue;
    }
    try {
      await engine.indexDocument(await job.load());
      indexed++;
    } catch {
      // Skip — the next sync retries.
    }
  }

  for (const id of existing.keys()) {
    if (liveIds.has(id)) continue;
    try {
      await engine.removeDocument(id);
      removed++;
    } catch {
      // Ignore — a stale entry is harmless until the next sync.
    }
  }

  markSynced(userId);
  return { indexed, removed, skipped };
}

function markSynced(userId: string): void {
  try {
    localStorage.setItem(`${LAST_SYNC_KEY_PREFIX}${userId}`, String(Date.now()));
    localStorage.setItem(`${CONTENT_VERSION_KEY_PREFIX}${userId}`, String(CONTENT_VERSION));
  } catch {
    // Private-mode storage failures must not break indexing.
  }
}

/**
 * Which version of the indexing code wrote this user's index. `0` covers both
 * "never indexed" and every index built before the marker existed — the latter
 * being exactly the ones that need re-reading.
 */
function storedContentVersion(userId: string): number {
  try {
    return Number(localStorage.getItem(`${CONTENT_VERSION_KEY_PREFIX}${userId}`) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/**
 * True when the index hasn't been synced within `SYNC_INTERVAL_MS`, or when it
 * was built by an older version — an index the current code can't use shouldn't
 * have to wait out the throttle before being rebuilt.
 */
export function isSyncDue(userId: string): boolean {
  try {
    if (storedContentVersion(userId) < CONTENT_VERSION) return true;
    const last = Number(localStorage.getItem(`${LAST_SYNC_KEY_PREFIX}${userId}`) ?? 0);
    return !Number.isFinite(last) || Date.now() - last > SYNC_INTERVAL_MS;
  } catch {
    return true;
  }
}
