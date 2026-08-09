/**
 * A note is a Drive file with the `application/x-neutrino-note` MIME type and
 * nothing else notes-specific server-side (see `agent_docs/notes-links-roadmap.md`
 * Phase 3) — these are the helpers `@neutrino/api-notes` used to centralize:
 * creating one, listing every note the caller owns across all folders (the
 * generic `filesystemApi.getRootContents`/`getFolderContents` are folder-scoped,
 * so a global list needs its own pass over `storageApi.listFiles`), and
 * flattening a stored note body to plain text for search indexing.
 */

import { storageApi, type FileInfo } from '@neutrino/api-drive';
import { NOTE_MIME } from '@/app/(apps)/drive/routeForFile';

const LIST_PAGE_SIZE = 200;
const LIST_MAX_PAGES = 5;

export interface NoteMeta {
  id: string;
  title: string;
  updatedAt: string;
}

/** Create a new, empty note at the given title/folder. */
export async function createNote(title: string, folderId?: string | null): Promise<FileInfo> {
  return storageApi.createFile({
    id: crypto.randomUUID(),
    name: title,
    mimeType: NOTE_MIME,
    folderId,
  });
}

/**
 * Every note the caller owns, across all folders — mirrors what the old
 * `notesApi.listNotes()` returned. Paged with a hard cap so a huge drive
 * can't stall the caller (same cap `searchIndexer.ts` uses for its own
 * whole-drive listing).
 */
export async function listAllNotes(): Promise<NoteMeta[]> {
  const notes: NoteMeta[] = [];
  for (let page = 0; page < LIST_MAX_PAGES; page++) {
    const res = await storageApi.listFiles({ limit: LIST_PAGE_SIZE, offset: page * LIST_PAGE_SIZE });
    for (const f of res.items) {
      if (f.mimeType === NOTE_MIME) notes.push({ id: f.id, title: f.name, updatedAt: f.updatedAt });
    }
    if (res.items.length < LIST_PAGE_SIZE) break;
  }
  return notes;
}

type NoteTableCell = { content?: string };
type NoteTableRow = { cells?: NoteTableCell[] };
type NoteBlock = { content?: string; tableData?: { rows?: NoteTableRow[] } };

/**
 * Flatten a stored note body into searchable plain text — every block's prose
 * plus any table cells.
 *
 * Note bodies are `JSON.stringify(Block[])`, so indexing the raw string would
 * feed block ids and JSON keys to the tokenizer. Legacy notes were saved as
 * plain text and are returned as-is.
 *
 * Takes the already-decrypted body rather than fetching it: note content is
 * E2EE, so only the caller holds the DEK needed to read it (see
 * `readDocumentText` in the web app).
 */
export function extractNoteText(raw: string): string {
  if (!raw.trim()) return '';

  let blocks: NoteBlock[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return raw.replace(/\s+/g, ' ').trim();
    blocks = parsed as NoteBlock[];
  } catch {
    return raw.replace(/\s+/g, ' ').trim();
  }

  const parts: string[] = [];
  for (const block of blocks) {
    if (block.content) parts.push(block.content);
    for (const row of block.tableData?.rows ?? []) {
      for (const cell of row.cells ?? []) {
        if (cell.content) parts.push(cell.content);
      }
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
