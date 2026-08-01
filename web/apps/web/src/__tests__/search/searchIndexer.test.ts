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
  calendarApi,
  storageApi,
  driveReadContent,
} = vi.hoisted(() => ({
  indexDocument: vi.fn(),
  removeDocument: vi.fn(),
  listDocuments: vi.fn(),
  clearSearchIndex: vi.fn(),
  notesApi: { listNotes: vi.fn(), getNote: vi.fn() },
  docsApi: { listDocs: vi.fn(), retrieveText: vi.fn() },
  sheetsApi: { listSheets: vi.fn(), retrieveText: vi.fn() },
  slidesApi: { listSlides: vi.fn(), retrieveText: vi.fn() },
  calendarApi: { listEvents: vi.fn(), listReminders: vi.fn() },
  storageApi: { listFiles: vi.fn() },
  driveReadContent: vi.fn(),
}));

vi.mock('@neutrino/search', () => ({
  IndexEngine: class {
    indexDocument = indexDocument;
    removeDocument = removeDocument;
    listDocuments = listDocuments;
  },
  clearSearchIndex,
  getOrCreateSearchKey: () => new Uint8Array(32).fill(1),
}));

vi.mock('@/lib/api', () => ({
  notesApi,
  docsApi,
  sheetsApi,
  slidesApi,
  calendarApi,
  storageApi,
  driveReadContent,
}));

import { collectIndexJobs, isSyncDue, rebuildSearchIndex, syncSearchIndex } from '@/lib/searchIndexer';

const NOTE_UPDATED = '2026-03-01T10:00:00.000Z';
const NOTE_UPDATED_MS = new Date(NOTE_UPDATED).getTime();

function withOneNote() {
  notesApi.listNotes.mockResolvedValue({
    notes: [{ id: 'note-1', title: 'Flamingo notes', updatedAt: NOTE_UPDATED }],
  });
  notesApi.getNote.mockResolvedValue({
    id: 'note-1',
    title: 'Flamingo notes',
    contentUrl: '/drive/note-1',
    updatedAt: NOTE_UPDATED,
  });
  driveReadContent.mockResolvedValue('body text');
}

describe('searchIndexer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    notesApi.listNotes.mockResolvedValue({ notes: [] });
    docsApi.listDocs.mockResolvedValue({ docs: [] });
    sheetsApi.listSheets.mockResolvedValue({ sheets: [] });
    slidesApi.listSlides.mockResolvedValue({ slides: [] });
    calendarApi.listEvents.mockResolvedValue({ events: [] });
    calendarApi.listReminders.mockResolvedValue({ reminders: [] });
    storageApi.listFiles.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200, totalPages: 0 });
    listDocuments.mockResolvedValue(new Map());
  });

  describe('collectIndexJobs', () => {
    it('collects one job per item across every content type', async () => {
      withOneNote();
      docsApi.listDocs.mockResolvedValue({ docs: [{ id: 'doc-1', title: 'Doc', updatedAt: NOTE_UPDATED }] });
      calendarApi.listEvents.mockResolvedValue({
        events: [{ id: 'evt-1', title: 'Standup', description: 'daily', updatedAt: NOTE_UPDATED }],
      });

      const jobs = await collectIndexJobs();

      expect(jobs.map((j) => j.id).sort()).toEqual(['doc-1', 'evt-1', 'note-1']);
      expect(jobs.find((j) => j.id === 'note-1')?.updatedAt).toBe(NOTE_UPDATED_MS);
    });

    it('keeps going when one content type fails to list', async () => {
      withOneNote();
      docsApi.listDocs.mockRejectedValue(new Error('503'));

      const jobs = await collectIndexJobs();

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

      const jobs = await collectIndexJobs();
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

      const jobs = await collectIndexJobs();

      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe('document');
    });

    it('loads the body only when the job is executed', async () => {
      withOneNote();

      const jobs = await collectIndexJobs();
      expect(driveReadContent).not.toHaveBeenCalled();

      const doc = await jobs[0].load();
      expect(doc).toMatchObject({ id: 'note-1', type: 'note', title: 'Flamingo notes', content: 'body text' });
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
      expect(driveReadContent).not.toHaveBeenCalled();
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
      withOneNote();
      docsApi.listDocs.mockResolvedValue({ docs: [{ id: 'doc-1', title: 'Doc', updatedAt: NOTE_UPDATED }] });
      docsApi.retrieveText.mockRejectedValue(new Error('decrypt failed'));

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
