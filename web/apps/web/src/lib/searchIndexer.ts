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
  getOrCreateSearchKey,
  IndexEngine,
  type SearchableDocType,
  type SearchableDocument,
} from '@neutrino/search';
import {
  calendarApi,
  docsApi,
  driveReadContent,
  notesApi,
  sheetsApi,
  slidesApi,
  storageApi,
  type FileItem,
} from '@/lib/api';
import {
  DOC_MIME,
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

const DRIVE_PAGE_SIZE = 200;
const DRIVE_MAX_PAGES = 5;

/**
 * A doc/sheet/slide/note *is* a Drive file with the same id, and its own app
 * already indexes it with full text. Skipping those mimetypes here stops the
 * name-only Drive pass from overwriting a richer entry.
 */
const APP_OWNED_MIMES = new Set([DOC_MIME, SHEET_MIME, SLIDES_MIME, NOTE_MIME]);

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

/**
 * Every indexable item across the apps that feed search. Listing failures for
 * one content type are non-fatal — the rest of the index still gets built.
 */
export async function collectIndexJobs(): Promise<IndexJob[]> {
  const [notesMeta, docsMeta, sheetsMeta, slidesMeta, eventsRes, remindersRes, driveFiles] =
    await Promise.allSettled([
      notesApi.listNotes(),
      docsApi.listDocs(),
      sheetsApi.listSheets(),
      slidesApi.listSlides(),
      calendarApi.listEvents(),
      calendarApi.listReminders(),
      listDriveFiles(),
    ]);

  const jobs: IndexJob[] = [];

  if (notesMeta.status === 'fulfilled') {
    for (const n of notesMeta.value.notes) {
      jobs.push({
        id: n.id,
        type: 'note',
        title: n.title,
        updatedAt: toMillis(n.updatedAt),
        load: async () => {
          const full = await notesApi.getNote(n.id);
          const content = await driveReadContent(full.contentUrl).catch(() => '');
          return {
            id: n.id,
            type: 'note',
            title: full.title,
            content,
            updatedAt: toMillis(full.updatedAt),
          };
        },
      });
    }
  }

  if (docsMeta.status === 'fulfilled') {
    for (const d of docsMeta.value.docs) {
      jobs.push({
        id: d.id,
        type: 'document',
        title: d.title,
        updatedAt: toMillis(d.updatedAt),
        load: async () => ({
          id: d.id,
          type: 'document',
          title: d.title,
          content: await docsApi.retrieveText(d.id),
          updatedAt: toMillis(d.updatedAt),
        }),
      });
    }
  }

  if (sheetsMeta.status === 'fulfilled') {
    for (const s of sheetsMeta.value.sheets) {
      jobs.push({
        id: s.id,
        type: 'spreadsheet',
        title: s.title,
        updatedAt: toMillis(s.updatedAt),
        load: async () => ({
          id: s.id,
          type: 'spreadsheet',
          title: s.title,
          content: await sheetsApi.retrieveText(s.id),
          updatedAt: toMillis(s.updatedAt),
        }),
      });
    }
  }

  if (slidesMeta.status === 'fulfilled') {
    for (const s of slidesMeta.value.slides) {
      jobs.push({
        id: s.id,
        type: 'slide',
        title: s.title,
        updatedAt: toMillis(s.updatedAt),
        load: async () => ({
          id: s.id,
          type: 'slide',
          title: s.title,
          content: await slidesApi.retrieveText(s.id),
          updatedAt: toMillis(s.updatedAt),
        }),
      });
    }
  }

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

  const jobs = await collectIndexJobs();
  const total = jobs.length;
  onProgress?.({ done: 0, total });
  if (total === 0) return 0;

  const searchKey = getOrCreateSearchKey(userId);
  const engine = new IndexEngine();

  for (let i = 0; i < jobs.length; i++) {
    try {
      await engine.indexDocument(await jobs[i].load(), searchKey);
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
  const searchKey = getOrCreateSearchKey(userId);
  const engine = new IndexEngine();

  const [jobs, existing] = await Promise.all([collectIndexJobs(), engine.listDocuments()]);

  const liveIds = new Set(jobs.map((j) => j.id));
  let indexed = 0;
  let skipped = 0;
  let removed = 0;

  for (const job of jobs) {
    const entry = existing.get(job.id);
    // A stored title of `''` means the entry predates title storage, so it
    // still needs a pass even when the timestamps line up.
    const upToDate = entry && entry.updatedAt >= job.updatedAt && Boolean(entry.title);
    if (upToDate) {
      skipped++;
      continue;
    }
    try {
      await engine.indexDocument(await job.load(), searchKey);
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
  } catch {
    // Private-mode storage failures must not break indexing.
  }
}

/** True when the index hasn't been synced within `SYNC_INTERVAL_MS`. */
export function isSyncDue(userId: string): boolean {
  try {
    const last = Number(localStorage.getItem(`${LAST_SYNC_KEY_PREFIX}${userId}`) ?? 0);
    return !Number.isFinite(last) || Date.now() - last > SYNC_INTERVAL_MS;
  } catch {
    return true;
  }
}
