/**
 * `listEveryDriveFile` is what the per-app list calls (`listDocs`, `listSheets`, …) page through
 * since they stopped at the first 200 files — so the editors' pickers and the search indexer see
 * every file, not the first page of them.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { listEveryDriveFile } from '@neutrino/api-core';

function page(ids: number[], total: number) {
  return new Response(JSON.stringify({ files: ids.map((id) => ({ id: String(id) })), total, limit: 200, offset: 0 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('listEveryDriveFile', () => {
  it('pages until the server’s total is reached', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(page(Array.from({ length: 200 }, (_, i) => i), 450))
      .mockResolvedValueOnce(page(Array.from({ length: 200 }, (_, i) => 200 + i), 450))
      .mockResolvedValueOnce(page(Array.from({ length: 50 }, (_, i) => 400 + i), 450));
    vi.stubGlobal('fetch', fetchMock);

    const files = await listEveryDriveFile<{ id: string }>(['a/b', 'c/d']);

    expect(files).toHaveLength(450);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map(([url]) => new URL(String(url), 'http://x'));
    expect(urls.map((u) => u.searchParams.get('offset'))).toEqual(['0', '200', '400']);
    expect(urls[0].searchParams.get('mimeType')).toBe('a/b,c/d');
  });

  it('stops after a full page that already reaches the total, without asking for an empty one', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page(Array.from({ length: 200 }, (_, i) => i), 200));
    vi.stubGlobal('fetch', fetchMock);

    expect(await listEveryDriveFile(['a/b'])).toHaveLength(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tolerates a response with no files array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 })));
    expect(await listEveryDriveFile(['a/b'])).toEqual([]);
  });
});
