/**
 * `listAllNotes` feeds the editor's [[wiki link]] targets and the search indexer. It asks the
 * server for notes only: listing every file and filtering here took five sequential requests on a
 * 1,000-file drive each time a note opened.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const listFiles = vi.fn();
vi.mock('@neutrino/api-drive', () => ({ storageApi: { listFiles: (...a: unknown[]) => listFiles(...a) } }));
vi.mock('@/app/(apps)/notes/editor/noteMarkdown', () => ({ markdownToBlocks: () => [] }));

import { listAllNotes } from '@/lib/noteFiles';

const file = (id: string, mimeType = 'text/markdown') => ({
  id,
  name: `Note ${id}`,
  mimeType,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
});

beforeEach(() => listFiles.mockReset());

describe('listAllNotes', () => {
  it('asks the server for notes only, in one request when they fit a page', async () => {
    listFiles.mockResolvedValue({ items: [file('a'), file('b')], total: 2 });

    const notes = await listAllNotes();

    expect(listFiles).toHaveBeenCalledTimes(1);
    expect(listFiles).toHaveBeenCalledWith(expect.objectContaining({ type: 'note', offset: 0 }));
    expect(notes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('pages through more notes than fit one page', async () => {
    const page = (start: number, n: number) => Array.from({ length: n }, (_, i) => file(`n${start + i}`));
    listFiles
      .mockResolvedValueOnce({ items: page(0, 200), total: 250 })
      .mockResolvedValueOnce({ items: page(200, 50), total: 250 });

    const notes = await listAllNotes();

    expect(listFiles).toHaveBeenCalledTimes(2);
    expect(listFiles.mock.calls[1][0]).toMatchObject({ type: 'note', offset: 200 });
    expect(notes).toHaveLength(250);
  });

  it('still drops anything that is not a note', async () => {
    listFiles.mockResolvedValue({ items: [file('a'), file('x', 'application/pdf')], total: 2 });
    expect((await listAllNotes()).map((n) => n.id)).toEqual(['a']);
  });
});
