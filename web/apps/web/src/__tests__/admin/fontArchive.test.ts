/**
 * Finding fonts in a dropped archive (`admin/fontArchive.ts`), issue #207.
 *
 * The archives are built rather than checked in as binaries, so the layout
 * each test depends on is visible in the test — and they are built with JSZip
 * while the module reads with zip.js, which keeps the two implementations
 * honest about the format. Same arrangement as `takeout/archive.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  FontArchiveError,
  displayNameForFont,
  fontFormatOf,
  isZipFile,
  readFontSources,
} from '@/app/(apps)/admin/fontArchive';

/** Bytes that will not compress away, so an entry is as big as it looks. */
function incompressible(bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = (i * 2654435761) % 256;
  return out;
}

async function zipFile(
  name: string,
  files: Record<string, string | Uint8Array>,
): Promise<File> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], name, { type: 'application/zip' });
}

function fontFile(name: string, size = 64): File {
  return new File([incompressible(size)], name, { type: 'font/ttf' });
}

// ---------------------------------------------------------------------------
// displayNameForFont
// ---------------------------------------------------------------------------

describe('displayNameForFont', () => {
  it.each([
    ['Roboto-BoldItalic.ttf', 'Roboto Bold Italic'],
    ['OpenSans_Condensed.otf', 'Open Sans Condensed'],
    ['NotoSansJP-Regular.woff2', 'Noto Sans JP Regular'],
    ['Inter.woff', 'Inter'],
    ['Roboto-100Thin.ttf', 'Roboto 100 Thin'],
  ])('turns %s into %s', (file, expected) => {
    expect(displayNameForFont(file)).toBe(expected);
  });

  it('reads the file name out of a path inside the archive', () => {
    expect(displayNameForFont('Roboto/static/Roboto-Medium.ttf')).toBe('Roboto Medium');
  });

  it("drops a variable font's axis list, which is not part of the family's name", () => {
    expect(displayNameForFont('Roboto[wdth,wght].ttf')).toBe('Roboto');
  });

  it('falls back to the file name rather than leaving the row blank', () => {
    expect(displayNameForFont('--.ttf')).toBe('--.ttf');
  });
});

// ---------------------------------------------------------------------------
// fontFormatOf / isZipFile
// ---------------------------------------------------------------------------

describe('fontFormatOf', () => {
  it('recognises the four formats the server accepts, whatever the case', () => {
    expect(fontFormatOf('a.woff2')).toBe('woff2');
    expect(fontFormatOf('a.WOFF')).toBe('woff');
    expect(fontFormatOf('dir/a.TtF')).toBe('ttf');
    expect(fontFormatOf('a.otf')).toBe('otf');
  });

  it('is null for anything else', () => {
    expect(fontFormatOf('OFL.txt')).toBeNull();
    expect(fontFormatOf('README')).toBeNull();
    expect(fontFormatOf('.ttf')).toBeNull();
  });
});

describe('isZipFile', () => {
  it('goes by the extension or the declared type', () => {
    expect(isZipFile(new File([], 'Roboto.zip'))).toBe(true);
    expect(isZipFile(new File([], 'Roboto', { type: 'application/zip' }))).toBe(true);
    expect(isZipFile(new File([], 'Roboto.ttf', { type: 'font/ttf' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readFontSources
// ---------------------------------------------------------------------------

describe('readFontSources', () => {
  it('lists every font in an archive and ignores the rest of it', async () => {
    const source = await readFontSources([
      await zipFile('Roboto.zip', {
        'Roboto/Roboto-Regular.ttf': incompressible(120),
        'Roboto/Roboto-Bold.ttf': incompressible(130),
        'Roboto/static/Roboto-Light.woff2': incompressible(90),
        'Roboto/OFL.txt': 'licence',
        'Roboto/specimen.html': '<html></html>',
      }),
    ]);

    expect(source.candidates.map((c) => c.suggestedName)).toEqual([
      'Roboto Bold',
      'Roboto Light',
      'Roboto Regular',
    ]);
    expect(source.candidates.map((c) => c.format)).toEqual(['ttf', 'woff2', 'ttf']);
    // A licence is furniture, not a failure — it is not reported at all.
    expect(source.skipped).toEqual([]);
    await source.close();
  });

  it('reads an entry only when it is asked for, and gets the real bytes back', async () => {
    const bytes = incompressible(256);
    const source = await readFontSources([
      await zipFile('Inter.zip', { 'Inter-Regular.woff2': bytes }),
    ]);

    const [candidate] = source.candidates;
    expect(candidate.size).toBe(256);

    const file = await candidate.read();
    expect(file.name).toBe('Inter-Regular.woff2');
    // The upload has to declare a type the server matches against `.woff2`.
    expect(file.type).toBe('font/woff2');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    await source.close();
  });

  it('leaves macOS archive housekeeping out, so a font is not listed twice', async () => {
    const source = await readFontSources([
      await zipFile('Family.zip', {
        'Family/Family-Regular.ttf': incompressible(100),
        '__MACOSX/Family/._Family-Regular.ttf': incompressible(80),
        'Family/.DS_Store': incompressible(40),
      }),
    ]);

    expect(source.candidates).toHaveLength(1);
    expect(source.candidates[0].path).toBe('Family/Family-Regular.ttf');
    await source.close();
  });

  it('names an over-sized font instead of letting the upload discover it', async () => {
    // The entry's declared uncompressed size is what the list reads, so a
    // sparse run of zeroes stands in for 50 MB without building 50 MB.
    const source = await readFontSources([
      await zipFile('Huge.zip', {
        'Huge-Regular.ttf': new Uint8Array(50 * 1024 * 1024 + 1),
        'Fine-Regular.ttf': incompressible(100),
      }),
    ]);

    expect(source.candidates.map((c) => c.path)).toEqual(['Fine-Regular.ttf']);
    expect(source.skipped).toEqual([
      { path: 'Huge-Regular.ttf', reason: 'larger than the 50 MB limit' },
    ]);
    await source.close();
  });

  it('takes loose font files as candidates of their own', async () => {
    const source = await readFontSources([
      fontFile('Lato-Regular.ttf', 10),
      fontFile('Lato-Bold.ttf', 12),
    ]);

    expect(source.candidates.map((c) => c.suggestedName)).toEqual(['Lato Bold', 'Lato Regular']);
    expect(source.candidates.every((c) => c.archive === null)).toBe(true);
    // A loose file is its own bytes; nothing is inflated for it.
    await expect(source.candidates[0].read()).resolves.toBeInstanceOf(File);
    await source.close();
  });

  it('merges a mixed drop and reports only what cannot be installed', async () => {
    const source = await readFontSources([
      await zipFile('Roboto.zip', { 'Roboto-Regular.ttf': incompressible(100) }),
      fontFile('Lato-Bold.ttf'),
      new File(['hello'], 'notes.txt', { type: 'text/plain' }),
    ]);

    expect(source.candidates.map((c) => c.suggestedName)).toEqual([
      'Lato Bold',
      'Roboto Regular',
    ]);
    expect(source.candidates.find((c) => c.suggestedName === 'Roboto Regular')!.archive).toBe(
      'Roboto.zip',
    );
    expect(source.skipped).toEqual([
      { path: 'notes.txt', reason: 'not a font or a zip archive' },
    ]);
    await source.close();
  });

  it('gives candidates from two archives distinct ids even for the same path', async () => {
    const source = await readFontSources([
      await zipFile('one.zip', { 'Regular.ttf': incompressible(10) }),
      await zipFile('two.zip', { 'Regular.ttf': incompressible(20) }),
    ]);

    const ids = source.candidates.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
    await source.close();
  });

  it('throws for a file that claims to be a zip and is not', async () => {
    const notAZip = new File([incompressible(64)], 'broken.zip', { type: 'application/zip' });
    await expect(readFontSources([notAZip])).rejects.toBeInstanceOf(FontArchiveError);
  });

  it('reports an archive with no fonts in it as empty rather than failing', async () => {
    const source = await readFontSources([
      await zipFile('Docs.zip', { 'README.md': '# nothing here' }),
    ]);
    expect(source.candidates).toEqual([]);
    await source.close();
  });
});
