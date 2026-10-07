/**
 * Browsing a zip from Drive (`lib/zipArchive.ts`).
 *
 * Archives are built with JSZip and read with zip.js, the same arrangement as
 * `admin/fontArchive.test.ts`, so the two implementations keep each other
 * honest about the format.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  buildTree,
  entryPreviewKind,
  entryMimeType,
  isMacOsMetadata,
  looksLikeText,
  normalizeEntryPath,
  openZipArchive,
  ZipArchiveError,
} from '@/lib/zipArchive';

async function zipBlob(files: Record<string, string | Uint8Array | null>): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    if (content === null) zip.folder(path);
    else zip.file(path, content, { createFolders: false });
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

function entry(filename: string, size = 0, directory = false) {
  return {
    filename, directory, uncompressedSize: size, compressedSize: size,
    lastModDate: new Date('2026-01-02T03:04:05Z'), encrypted: false,
  };
}

describe('normalizeEntryPath', () => {
  it.each([
    ['a/b.txt', 'a/b.txt'],
    ['./a/b.txt', 'a/b.txt'],
    ['/abs/b.txt', 'abs/b.txt'],
    ['a\\b\\c.txt', 'a/b/c.txt'],
    ['../../etc/passwd', 'etc/passwd'],
    ['dir/', 'dir'],
    ['a//b', 'a/b'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeEntryPath(raw)).toBe(expected);
  });
});

describe('isMacOsMetadata', () => {
  it('flags what Finder adds and nothing else', () => {
    expect(isMacOsMetadata('__MACOSX/a/._b.txt')).toBe(true);
    expect(isMacOsMetadata('a/.DS_Store')).toBe(true);
    expect(isMacOsMetadata('a/._b.txt')).toBe(true);
    expect(isMacOsMetadata('a/.gitignore')).toBe(false);
    expect(isMacOsMetadata('a/b.txt')).toBe(false);
  });
});

describe('buildTree', () => {
  it('synthesises folders no entry declares, and sums their sizes', () => {
    const { children, nodes } = buildTree([entry('src/lib/a.ts', 10), entry('src/b.ts', 5), entry('README', 3)]);
    expect(children.get('')!.map((n) => n.name)).toEqual(['src', 'README']);
    expect(children.get('src')!.map((n) => n.name)).toEqual(['lib', 'b.ts']);
    expect(nodes.get('src')!.size).toBe(15);
    expect(nodes.get('src/lib')!.size).toBe(10);
  });

  it('sorts folders before files and numbers by value', () => {
    const { children } = buildTree([entry('file10.txt'), entry('file2.txt'), entry('z/x.txt')]);
    expect(children.get('')!.map((n) => n.name)).toEqual(['z', 'file2.txt', 'file10.txt']);
  });

  it('drops macOS metadata', () => {
    const { children } = buildTree([entry('a.txt'), entry('__MACOSX/._a.txt'), entry('.DS_Store')]);
    expect(children.get('')!.map((n) => n.name)).toEqual(['a.txt']);
  });

  it('keeps an empty directory entry as a folder', () => {
    const { children } = buildTree([entry('empty/', 0, true)]);
    expect(children.get('')!.map((n) => [n.name, n.isDir])).toEqual([['empty', true]]);
    expect(children.get('empty')).toEqual([]);
  });
});

describe('openZipArchive', () => {
  it('lists a folder and reads one entry out of it', async () => {
    const archive = await openZipArchive(await zipBlob({
      'docs/readme.md': '# Hello',
      'docs/img/pixel.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      'top.txt': 'top level',
    }));
    try {
      expect(archive.fileCount).toBe(3);
      expect(archive.list('').map((n) => n.name)).toEqual(['docs', 'top.txt']);
      expect(archive.list('docs').map((n) => n.name)).toEqual(['img', 'readme.md']);
      expect(await (await archive.read('docs/readme.md')).text()).toBe('# Hello');
      expect((await archive.read('docs/img/pixel.png', 'image/png')).type).toBe('image/png');
    } finally {
      await archive.close();
    }
  });

  it('refuses to read a folder', async () => {
    const archive = await openZipArchive(await zipBlob({ 'a/b.txt': 'x' }));
    await expect(archive.read('a')).rejects.toBeInstanceOf(ZipArchiveError);
    await archive.close();
  });

  it('says plainly when the bytes are not a zip', async () => {
    await expect(openZipArchive(new Blob(['not a zip at all']))).rejects.toThrow('not a valid zip archive');
  });
});

describe('entry preview kind', () => {
  it.each([
    ['photo.JPG', 'image'],
    ['logo.svg', 'image'],
    ['report.pdf', 'pdf'],
    ['clip.mp4', 'video'],
    ['song.mp3', 'audio'],
    ['main.rs', 'text'],
    ['.gitignore', 'text'],
    ['Makefile', 'text'],
    ['LICENSE', 'text'],
    ['app.exe', 'unknown'],
  ])('%s is %s', (name, kind) => {
    expect(entryPreviewKind(name)).toBe(kind);
  });

  it('types a blob so the browser renders it', () => {
    expect(entryMimeType('a/b.png')).toBe('image/png');
    expect(entryMimeType('a/b.pdf')).toBe('application/pdf');
    expect(entryMimeType('a/b.bin')).toBe('application/octet-stream');
  });

  it('tells text from binary by its bytes', () => {
    expect(looksLikeText(new TextEncoder().encode('héllo\nworld'))).toBe(true);
    expect(looksLikeText(new Uint8Array([0x48, 0x00, 0x49]))).toBe(false);
    expect(looksLikeText(new Uint8Array([0xff, 0xfe, 0xfd]))).toBe(false);
  });
});
