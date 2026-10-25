/**
 * Turning what the user picked into an import plan's raw material
 * (`lib/localImport/scan.ts`).
 *
 * Three ways in — a folder input (`webkitRelativePath`), a plain file input,
 * and a drop (`webkitGetAsEntry` directory walking) — must all produce the
 * same relative paths, because the path is both the folder structure the
 * import recreates and the key a retry finds a file by.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  scanFiles,
  pickedFromFileList,
  pickedFromDataTransfer,
  type PickedFile,
} from '@/lib/localImport/scan';

function fileOf(name: string, size: number, type = ''): File {
  return new File([new Uint8Array(size)], name, { type });
}

function picked(path: string, size: number, type = ''): PickedFile {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return { file: fileOf(name, size, type), path };
}

describe('scanFiles', () => {
  it('adds a kind and an upload mime type to every file', () => {
    const result = scanFiles([picked('Trip/IMG_1.jpg', 10), picked('Trip/report.docx', 5)]);
    expect(result.files.map((f) => [f.path, f.kind, f.mimeType])).toEqual([
      ['Trip/IMG_1.jpg', 'media', 'image/jpeg'],
      [
        'Trip/report.docx',
        'office',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
    ]);
  });

  it('totals bytes across every file', () => {
    const result = scanFiles([picked('a/1.jpg', 10), picked('a/2.md', 7), picked('b.pdf', 3)]);
    expect(result.totalBytes).toBe(20);
  });

  it('counts and sizes each kind, listing kinds with no files as zero', () => {
    const result = scanFiles([picked('a/1.jpg', 10), picked('a/2.jpg', 4), picked('a/n.md', 7)]);
    expect(result.byKind).toEqual({
      media: { count: 2, bytes: 14 },
      office: { count: 0, bytes: 0 },
      markdown: { count: 1, bytes: 7 },
      other: { count: 0, bytes: 0 },
    });
  });

  it('drops OS clutter from the files and the totals, and counts it', () => {
    const result = scanFiles([
      picked('Trip/IMG_1.jpg', 10),
      picked('Trip/.DS_Store', 1000),
      picked('Trip/Thumbs.db', 500),
    ]);
    expect(result.files.map((f) => f.path)).toEqual(['Trip/IMG_1.jpg']);
    expect(result.totalBytes).toBe(10);
    expect(result.byKind.other).toEqual({ count: 0, bytes: 0 });
    expect(result.ignored).toBe(2);
  });

  it('lists the top-level folders, sorted and unique', () => {
    const result = scanFiles([
      picked('Zoo/a.jpg', 1),
      picked('Alps/b.jpg', 1),
      picked('Zoo/sub/c.jpg', 1),
    ]);
    expect(result.roots).toEqual(['Alps', 'Zoo']);
  });

  it('gives loose files no root', () => {
    const result = scanFiles([picked('loose.txt', 1), picked('Trip/a.jpg', 1)]);
    expect(result.roots).toEqual(['Trip']);
    expect(scanFiles([picked('loose.txt', 1)]).roots).toEqual([]);
  });

  it('handles an empty pick', () => {
    const result = scanFiles([]);
    expect(result.files).toEqual([]);
    expect(result.totalBytes).toBe(0);
    expect(result.ignored).toBe(0);
    expect(result.roots).toEqual([]);
    expect(result.byKind.media).toEqual({ count: 0, bytes: 0 });
  });
});

describe('pickedFromFileList', () => {
  function withRelativePath(file: File, rel: string): File {
    Object.defineProperty(file, 'webkitRelativePath', { value: rel, configurable: true });
    return file;
  }

  it('uses the folder-relative path a folder input reports', () => {
    const file = withRelativePath(fileOf('IMG_1.jpg', 1), 'Holiday/beach/IMG_1.jpg');
    const result = pickedFromFileList([file]);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('Holiday/beach/IMG_1.jpg');
    expect(result[0].file).toBe(file);
  });

  it('falls back to the name when there is no relative path', () => {
    const file = withRelativePath(fileOf('loose.txt', 1), '');
    expect(pickedFromFileList([file])[0].path).toBe('loose.txt');
  });
});

// ── DataTransfer directory walking ────────────────────────────────────────────

interface FakeEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (cb: (e: FakeEntry[]) => void, err?: (e: unknown) => void) => void };
}

function fileEntry(fullPath: string, size = 1): FakeEntry {
  const name = fullPath.slice(fullPath.lastIndexOf('/') + 1);
  const file = fileOf(name, size);
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file: (cb) => cb(file),
  };
}

/**
 * A directory whose reader hands its children back `batchSize` at a time and
 * then `[]`, as Chrome does (100 per call) — a walker that calls `readEntries`
 * once silently loses everything past the first batch.
 */
function dirEntry(fullPath: string, children: FakeEntry[], batchSize = 100) {
  const name = fullPath.slice(fullPath.lastIndexOf('/') + 1);
  const readCalls = { count: 0 };
  const entry: FakeEntry = {
    isFile: false,
    isDirectory: true,
    name,
    fullPath,
    createReader: () => {
      let offset = 0;
      return {
        readEntries: (cb) => {
          readCalls.count++;
          const batch = children.slice(offset, offset + batchSize);
          offset += batch.length;
          // Async, like the real API.
          setTimeout(() => cb(batch), 0);
        },
      };
    },
  };
  return { entry, readCalls };
}

function fakeDataTransfer(entries: (FakeEntry | null)[], files: File[] = []): DataTransfer {
  const items = entries.map((e) => ({
    kind: 'file',
    webkitGetAsEntry: e === null ? undefined : () => e,
    getAsFile: () => null,
  }));
  return { items, files } as unknown as DataTransfer;
}

describe('pickedFromDataTransfer', () => {
  it('walks dropped folders into relative paths with no leading slash', async () => {
    const beach = dirEntry('/Holiday/beach', [fileEntry('/Holiday/beach/IMG_1.jpg')]);
    const holiday = dirEntry('/Holiday', [beach.entry, fileEntry('/Holiday/notes.md')]);

    const result = await pickedFromDataTransfer(fakeDataTransfer([holiday.entry]));

    expect(result.map((p) => p.path).sort()).toEqual(['Holiday/beach/IMG_1.jpg', 'Holiday/notes.md']);
    expect(result.find((p) => p.path === 'Holiday/notes.md')?.file.name).toBe('notes.md');
  });

  it('keeps reading a directory until the reader returns nothing', async () => {
    const children = Array.from({ length: 250 }, (_, i) => fileEntry(`/Big/f${i}.txt`));
    const big = dirEntry('/Big', children, 100);

    const result = await pickedFromDataTransfer(fakeDataTransfer([big.entry]));

    expect(result).toHaveLength(250);
    // 100 + 100 + 50, then the empty batch that ends it.
    expect(big.readCalls.count).toBeGreaterThanOrEqual(4);
  });

  it('takes a dropped loose file at its name', async () => {
    const result = await pickedFromDataTransfer(fakeDataTransfer([fileEntry('/loose.txt')]));
    expect(result.map((p) => p.path)).toEqual(['loose.txt']);
  });

  it('falls back to dt.files when the entry API is missing', async () => {
    const a = fileOf('a.jpg', 1);
    const b = fileOf('b.md', 1);
    const dt = fakeDataTransfer([null, null], [a, b]);

    const result = await pickedFromDataTransfer(dt);

    expect(result.map((p) => p.path).sort()).toEqual(['a.jpg', 'b.md']);
    expect(result.find((p) => p.path === 'a.jpg')?.file).toBe(a);
  });

  it('does not fail on an empty drop', async () => {
    const spy = vi.fn();
    const result = await pickedFromDataTransfer(fakeDataTransfer([])).catch(spy);
    expect(spy).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
