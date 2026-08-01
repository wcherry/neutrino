import { describe, it, expect, beforeEach, vi } from 'vitest';

const {
  indexDocument,
  removeDocument,
  listDocuments,
  clearSearchIndex,
  notesApi,
  docsApi,
  sheetsApi,
  slidesApi,
  diagramsApi,
  drawingApi,
  calendarApi,
  storageApi,
  readDocumentText,
} = vi.hoisted(() => ({
  indexDocument: vi.fn(),
  removeDocument: vi.fn(),
  listDocuments: vi.fn(),
  clearSearchIndex: vi.fn(),
  notesApi: { listNotes: vi.fn() },
  docsApi: { listDocs: vi.fn() },
  sheetsApi: { listSheets: vi.fn() },
  slidesApi: { listSlides: vi.fn() },
  diagramsApi: { listDiagrams: vi.fn() },
  drawingApi: { listDrawings: vi.fn() },
  calendarApi: { listEvents: vi.fn(), listReminders: vi.fn() },
  storageApi: { listFiles: vi.fn() },
  readDocumentText: vi.fn(),
}));

vi.mock('@neutrino/search', () => ({
  IndexEngine: class {
    indexDocument = indexDocument;
    removeDocument = removeDocument;
    listDocuments = listDocuments;
  },
  clearSearchIndex,
}));

// The listing APIs are stubbed, but the text extractors are the real ones —
// they are the half of indexing that turns a stored body into tokens, and
// stubbing them is what hid the bug where every encrypted document indexed as
// empty content.
vi.mock('@/lib/api', async () => {
  const [notes, docs, sheets, slides, diagrams, drawing] = await Promise.all([
    import('@neutrino/api-notes'),
    import('@neutrino/api-docs'),
    import('@neutrino/api-sheets'),
    import('@neutrino/api-slides'),
    import('@neutrino/api-diagrams'),
    import('@neutrino/api-drawing'),
  ]);
  return {
    notesApi,
    docsApi,
    sheetsApi,
    slidesApi,
    diagramsApi,
    drawingApi,
    calendarApi,
    storageApi,
    extractNoteText: notes.extractNoteText,
    extractDocText: docs.extractDocText,
    extractSheetText: sheets.extractSheetText,
    extractSlideText: slides.extractSlideText,
    extractDiagramText: diagrams.extractDiagramText,
    extractDrawingText: drawing.extractDrawingText,
  };
});

vi.mock('@/lib/documentContent', () => ({ readDocumentText }));

import { collectIndexJobs, isSyncDue, rebuildSearchIndex, syncSearchIndex } from '@/lib/searchIndexer';

const USER = 'user-1';
const NOTE_UPDATED = '2026-03-01T10:00:00.000Z';
const NOTE_UPDATED_MS = new Date(NOTE_UPDATED).getTime();

/**
 * Marks the stored index as written by the current indexer. Most tests want the
 * steady state, where the sync is free to trust `updatedAt`; the upgrade test
 * clears this to get the "index built by older code" behaviour.
 */
const CONTENT_VERSION_KEY = `neutrino:search:contentVersion:${USER}`;
function withCurrentIndexVersion() {
  localStorage.setItem(CONTENT_VERSION_KEY, '4');
}

/** A note whose decrypted body is one paragraph block reading "body text". */
function withOneNote() {
  notesApi.listNotes.mockResolvedValue({
    notes: [{ id: 'note-1', title: 'Flamingo notes', updatedAt: NOTE_UPDATED }],
  });
  readDocumentText.mockResolvedValue(
    JSON.stringify([{ id: 'b1', type: 'paragraph', content: 'body text' }]),
  );
}

describe('searchIndexer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    notesApi.listNotes.mockResolvedValue({ notes: [] });
    docsApi.listDocs.mockResolvedValue({ docs: [] });
    sheetsApi.listSheets.mockResolvedValue({ sheets: [] });
    slidesApi.listSlides.mockResolvedValue({ slides: [] });
    diagramsApi.listDiagrams.mockResolvedValue({ diagrams: [] });
    drawingApi.listDrawings.mockResolvedValue({ drawings: [] });
    calendarApi.listEvents.mockResolvedValue({ events: [] });
    calendarApi.listReminders.mockResolvedValue({ reminders: [] });
    storageApi.listFiles.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200, totalPages: 0 });
    listDocuments.mockResolvedValue(new Map());
    readDocumentText.mockResolvedValue('');
    withCurrentIndexVersion();
  });

  describe('collectIndexJobs', () => {
    it('collects one job per item across every content type', async () => {
      withOneNote();
      docsApi.listDocs.mockResolvedValue({ docs: [{ id: 'doc-1', title: 'Doc', updatedAt: NOTE_UPDATED }] });
      calendarApi.listEvents.mockResolvedValue({
        events: [{ id: 'evt-1', title: 'Standup', description: 'daily', updatedAt: NOTE_UPDATED }],
      });

      const jobs = await collectIndexJobs(USER);

      expect(jobs.map((j) => j.id).sort()).toEqual(['doc-1', 'evt-1', 'note-1']);
      expect(jobs.find((j) => j.id === 'note-1')?.updatedAt).toBe(NOTE_UPDATED_MS);
    });

    it('keeps going when one content type fails to list', async () => {
      withOneNote();
      docsApi.listDocs.mockRejectedValue(new Error('503'));

      const jobs = await collectIndexJobs(USER);

      expect(jobs.map((j) => j.id)).toEqual(['note-1']);
    });

    it('indexes plain Drive files by name so uploads are findable', async () => {
      storageApi.listFiles.mockResolvedValue({
        items: [
          { id: 'file-1', name: 'Invoice.pdf', mimeType: 'application/pdf', updatedAt: NOTE_UPDATED },
        ],
        total: 1,
        page: 1,
        pageSize: 200,
        totalPages: 1,
      });

      const jobs = await collectIndexJobs(USER);
      const doc = await jobs[0].load();

      expect(doc).toMatchObject({
        id: 'file-1',
        type: 'file',
        title: 'Invoice.pdf',
        mimeType: 'application/pdf',
      });
    });

    it('leaves app-owned files to their own app so full text is not lost', async () => {
      docsApi.listDocs.mockResolvedValue({ docs: [{ id: 'doc-1', title: 'Doc', updatedAt: NOTE_UPDATED }] });
      storageApi.listFiles.mockResolvedValue({
        items: [
          { id: 'doc-1', name: 'Doc', mimeType: 'application/x-neutrino-doc', updatedAt: NOTE_UPDATED },
        ],
        total: 1,
        page: 1,
        pageSize: 200,
        totalPages: 1,
      });

      const jobs = await collectIndexJobs(USER);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe('document');
    });

    it('loads the body only when the job is executed', async () => {
      withOneNote();

      const jobs = await collectIndexJobs(USER);
      expect(readDocumentText).not.toHaveBeenCalled();

      const doc = await jobs[0].load();
      expect(doc).toMatchObject({ id: 'note-1', type: 'note', title: 'Flamingo notes', content: 'body text' });
    });

    it('indexes the full text of every app that stores an encrypted body', async () => {
      docsApi.listDocs.mockResolvedValue({ docs: [{ id: 'doc-1', title: 'Doc', updatedAt: NOTE_UPDATED }] });
      sheetsApi.listSheets.mockResolvedValue({ sheets: [{ id: 'sheet-1', title: 'Sheet', updatedAt: NOTE_UPDATED }] });
      slidesApi.listSlides.mockResolvedValue({ slides: [{ id: 'slide-1', title: 'Deck', updatedAt: NOTE_UPDATED }] });
      diagramsApi.listDiagrams.mockResolvedValue({ diagrams: [{ id: 'dia-1', title: 'Flow', updatedAt: NOTE_UPDATED }] });
      drawingApi.listDrawings.mockResolvedValue({ drawings: [{ id: 'draw-1', title: 'Sketch', updatedAt: NOTE_UPDATED }] });

      // Each app's stored body, as `readDocumentText` would hand it back once
      // decrypted — all of them mentioning Modesto somewhere in the content.
      const bodies: Record<string, string> = {
        'doc-1': JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Modesto quarterly' }] }],
        }),
        'sheet-1': JSON.stringify({ sheets: [{ cells: { A1: { raw: 'Modesto', value: 'Modesto' } } }] }),
        'slide-1': JSON.stringify({ slides: [{ elements: [{ type: 'text', content: 'Modesto' }] }] }),
        'dia-1': JSON.stringify({ pages: [{ shapes: [{ label: 'Modesto' }], connectors: [] }] }),
        'draw-1': JSON.stringify({ version: 1, shapes: [{ text: 'Modesto' }] }),
      };
      readDocumentText.mockImplementation((_userId: string, id: string) => Promise.resolve(bodies[id] ?? ''));

      const jobs = await collectIndexJobs(USER);
      const loaded = await Promise.all(jobs.map((j) => j.load()));

      expect(loaded.map((d) => [d.type, d.content])).toEqual([
        ['document', 'Modesto quarterly'],
        ['spreadsheet', 'Modesto'],
        ['slide', 'Modesto'],
        ['diagram', 'Modesto'],
        ['drawing', 'Modesto'],
      ]);
    });

    it('reads each body by file id, so encrypted content is decrypted first', async () => {
      docsApi.listDocs.mockResolvedValue({ docs: [{ id: 'doc-1', title: 'Doc', updatedAt: NOTE_UPDATED }] });

      const jobs = await collectIndexJobs(USER);
      await jobs[0].load();

      expect(readDocumentText).toHaveBeenCalledWith(USER, 'doc-1');
    });
  });

  describe('syncSearchIndex', () => {
    it('indexes items that are missing from the index', async () => {
      withOneNote();

      const result = await syncSearchIndex('user-1');

      expect(indexDocument).toHaveBeenCalledTimes(1);
      expect(indexDocument.mock.calls[0][0]).toMatchObject({ id: 'note-1', content: 'body text' });
      expect(result).toMatchObject({ indexed: 1, skipped: 0, removed: 0 });
    });

    it('skips unchanged items without refetching their content', async () => {
      withOneNote();
      listDocuments.mockResolvedValue(
        new Map([['note-1', { documentId: 'note-1', title: 'Flamingo notes', updatedAt: NOTE_UPDATED_MS }]]),
      );

      const result = await syncSearchIndex('user-1');

      expect(indexDocument).not.toHaveBeenCalled();
      expect(readDocumentText).not.toHaveBeenCalled();
      expect(result).toMatchObject({ indexed: 0, skipped: 1 });
    });

    it('re-indexes an item whose server copy is newer', async () => {
      withOneNote();
      listDocuments.mockResolvedValue(
        new Map([['note-1', { documentId: 'note-1', title: 'Old title', updatedAt: NOTE_UPDATED_MS - 1000 }]]),
      );

      const result = await syncSearchIndex('user-1');

      expect(indexDocument).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ indexed: 1, skipped: 0 });
    });

    it('re-reads content once when the index was built by an older version', async () => {
      // The pre-fix indexer stored these entries with the right title and
      // timestamp but empty content, so the timestamp check alone would skip
      // them forever.
      withOneNote();
      localStorage.removeItem(CONTENT_VERSION_KEY);
      listDocuments.mockResolvedValue(
        new Map([['note-1', { documentId: 'note-1', title: 'Flamingo notes', updatedAt: NOTE_UPDATED_MS }]]),
      );

      const first = await syncSearchIndex('user-1');
      expect(first).toMatchObject({ indexed: 1, skipped: 0 });
      expect(indexDocument.mock.calls[0][0]).toMatchObject({ content: 'body text' });

      // ...and only once: the following sync trusts timestamps again.
      indexDocument.mockClear();
      const second = await syncSearchIndex('user-1');
      expect(second).toMatchObject({ indexed: 0, skipped: 1 });
      expect(indexDocument).not.toHaveBeenCalled();
    });

    it('re-indexes entries stored before titles were indexed', async () => {
      withOneNote();
      listDocuments.mockResolvedValue(
        new Map([['note-1', { documentId: 'note-1', title: '', updatedAt: NOTE_UPDATED_MS }]]),
      );

      await syncSearchIndex('user-1');

      expect(indexDocument).toHaveBeenCalledTimes(1);
    });

    it('drops index entries for items that no longer exist', async () => {
      listDocuments.mockResolvedValue(
        new Map([['note-gone', { documentId: 'note-gone', title: 'Deleted', updatedAt: NOTE_UPDATED_MS }]]),
      );

      const result = await syncSearchIndex('user-1');

      expect(removeDocument).toHaveBeenCalledWith('note-gone');
      expect(result).toMatchObject({ removed: 1 });
    });

    it('does not let one failing item abort the run', async () => {
      docsApi.listDocs.mockResolvedValue({ docs: [{ id: 'doc-1', title: 'Doc', updatedAt: NOTE_UPDATED }] });
      notesApi.listNotes.mockResolvedValue({
        notes: [{ id: 'note-1', title: 'Flamingo notes', updatedAt: NOTE_UPDATED }],
      });
      readDocumentText.mockImplementation((_userId: string, id: string) =>
        id === 'doc-1'
          ? Promise.reject(new Error('decrypt failed'))
          : Promise.resolve(JSON.stringify([{ id: 'b1', type: 'paragraph', content: 'body text' }])),
      );

      const result = await syncSearchIndex('user-1');

      expect(result.indexed).toBe(1);
      expect(indexDocument.mock.calls[0][0]).toMatchObject({ id: 'note-1' });
    });
  });

  describe('rebuildSearchIndex', () => {
    it('wipes the index first and reports progress', async () => {
      withOneNote();
      const progress: { done: number; total: number }[] = [];

      const total = await rebuildSearchIndex('user-1', (p) => progress.push(p));

      expect(clearSearchIndex).toHaveBeenCalled();
      expect(total).toBe(1);
      expect(progress).toEqual([{ done: 0, total: 1 }, { done: 1, total: 1 }]);
    });

    it('reports zero for an account with nothing to index', async () => {
      expect(await rebuildSearchIndex('user-1')).toBe(0);
      expect(indexDocument).not.toHaveBeenCalled();
    });
  });

  describe('isSyncDue', () => {
    it('is due when the index has never been synced', () => {
      expect(isSyncDue('user-1')).toBe(true);
    });

    it('is due immediately when the index was built by an older version', async () => {
      // The stored index can't be read by the current code, so it shouldn't
      // have to wait out the throttle before being rebuilt.
      await syncSearchIndex('user-1');
      expect(isSyncDue('user-1')).toBe(false);

      localStorage.setItem(CONTENT_VERSION_KEY, '1');
      expect(isSyncDue('user-1')).toBe(true);
    });

    it('is not due immediately after a sync', async () => {
      await syncSearchIndex('user-1');
      expect(isSyncDue('user-1')).toBe(false);
    });

    it('is due again once the interval has passed', async () => {
      await syncSearchIndex('user-1');
      vi.useFakeTimers();
      try {
        vi.setSystemTime(Date.now() + 6 * 60_000);
        expect(isSyncDue('user-1')).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
