/**
 * Tests for reading a Takeout zip (`lib/takeout/archive.ts`).
 *
 * The archives are built rather than checked in as binaries, so the layout
 * each test depends on is visible in the test. They are built with JSZip while
 * the module under test reads with zip.js, which also keeps the two
 * implementations honest about the format.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { openTakeout, TakeoutError } from '@/lib/takeout/archive';

async function zipOf(files: Record<string, string | Uint8Array>): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: 'blob' });
}

/** A zip whose entries carry the dates given, rather than the moment it was built. */
async function zipDated(files: Record<string, Date>): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, date] of Object.entries(files)) zip.file(path, 'x', { date });
  return zip.generateAsync({ type: 'blob' });
}

/** Bytes that will not compress away, so the archive is as big as it looks. */
function incompressible(bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = (i * 2654435761) % 256;
  return out;
}

/**
 * A real Blob that counts the bytes read out of it.
 *
 * `slice` is what a random-access reader uses to seek, so the running total is
 * a direct measure of how much of the archive has actually been touched.
 */
function counting(blob: Blob): { blob: Blob; read: () => number } {
  let read = 0;
  const slice = blob.slice.bind(blob);
  Object.defineProperty(blob, 'slice', {
    value: (start?: number, end?: number) => {
      const part = slice(start, end);
      read += part.size;
      return part;
    },
  });
  return { blob, read: () => read };
}

describe('openTakeout', () => {
  it('strips the Takeout wrapper and groups entries by product', async () => {
    const archive = await openTakeout(
      await zipOf({
        'Takeout/archive_browser.html': '<html></html>',
        'Takeout/Keep/Note one.json': '{}',
        'Takeout/Keep/Note one.html': '<html></html>',
        'Takeout/Calendar/me@example.com.ics': 'BEGIN:VCALENDAR',
      }),
    );

    expect(archive.root).toBe('Takeout/');
    expect(archive.products.map((p) => p.name)).toEqual(['Calendar', 'Keep']);
    expect(archive.product('Keep')!.entries.map((e) => e.path)).toEqual([
      'Note one.html',
      'Note one.json',
    ]);
  });

  // ── Entry dates (issue #110) ────────────────────────────────────────────

  /**
   * The last resort for dating an imported file, and the only source for the
   * pictures that reached Drive rather than Photos — those have no sidecar at
   * all. Without it the import falls back to its own clock, which is the bug.
   */
  it('carries each entry’s own last-modified date', async () => {
    const archive = await openTakeout(
      await zipDated({ 'Takeout/Keep/a.json': new Date('2014-03-01T12:00:00Z') }),
    );

    const [entry] = archive.product('Keep')!.entries;
    // A zip stores local time with no zone, so the wall clock is what
    // survives the round trip; the date is what the import reads off it.
    expect(entry.lastModified!.getFullYear()).toBe(2014);
    expect(entry.lastModified!.getMonth()).toBe(2);
  });

  /**
   * A zip may legally leave the timestamp unset, which reads back as 1980 (or
   * an Invalid Date). Written onto a file that is indistinguishable from a
   * real 1980, so it has to be dropped instead.
   */
  it('reports no date rather than the 1980 an unset timestamp reads back as', async () => {
    const archive = await openTakeout(
      await zipDated({ 'Takeout/Keep/a.json': new Date('1980-01-01T00:00:00Z') }),
    );

    expect(archive.product('Keep')!.entries[0].lastModified).toBeNull();
  });

  it('drops files sitting directly in the archive root', async () => {
    const archive = await openTakeout(
      await zipOf({ 'Takeout/archive_browser.html': 'x', 'Takeout/Keep/a.json': '{}' }),
    );
    expect(archive.products).toHaveLength(1);
    expect(archive.products[0].name).toBe('Keep');
  });

  it('handles a wrapper directory Google localised', async () => {
    // The wrapper is detected by shape — one shared top-level directory — so
    // a non-English export works without knowing the translated word.
    const archive = await openTakeout(await zipOf({ 'Adatexport/Keep/a.json': '{}' }));
    expect(archive.root).toBe('Adatexport/');
    expect(archive.product('keep')).toBeDefined();
  });

  it('handles an archive with no wrapper directory', async () => {
    const archive = await openTakeout(
      await zipOf({ 'Keep/a.json': '{}', 'Calendar/b.ics': 'BEGIN:VCALENDAR' }),
    );
    expect(archive.root).toBe('');
    expect(archive.products.map((p) => p.name)).toEqual(['Calendar', 'Keep']);
  });

  it('ignores the metadata macOS adds when zipping', async () => {
    const archive = await openTakeout(
      await zipOf({
        '__MACOSX/._Takeout': 'junk',
        'Takeout/.DS_Store': 'junk',
        'Takeout/Keep/.DS_Store': 'junk',
        'Takeout/Keep/a.json': '{}',
      }),
    );
    // Without the filter, __MACOSX would be a second top-level directory and
    // the wrapper would go undetected.
    expect(archive.root).toBe('Takeout/');
    expect(archive.products.map((p) => p.name)).toEqual(['Keep']);
    expect(archive.product('Keep')!.entries.map((e) => e.path)).toEqual(['a.json']);
  });

  it('looks entries up by name case-insensitively', async () => {
    const archive = await openTakeout(await zipOf({ 'Takeout/Keep/a.json': '{}' }));
    expect(archive.product('KEEP')).toBeDefined();
    expect(archive.product('Photos')).toBeUndefined();
  });

  it('exposes each entry’s path, extension and content', async () => {
    const archive = await openTakeout(await zipOf({ 'Takeout/Keep/My note.json': '{"a":1}' }));
    const entry = archive.product('Keep')!.entries[0];
    expect(entry.path).toBe('My note.json');
    expect(entry.fullPath).toBe('Takeout/Keep/My note.json');
    expect(entry.ext).toBe('json');
    await expect(entry.text()).resolves.toBe('{"a":1}');
  });

  it('reports an extension only when there is one', async () => {
    const archive = await openTakeout(await zipOf({ 'Takeout/Keep/LICENSE': 'x' }));
    expect(archive.product('Keep')!.entries[0].ext).toBe('');
  });

  it('rejects a file that is not a zip', async () => {
    await expect(openTakeout(new Blob(['not a zip']))).rejects.toBeInstanceOf(TakeoutError);
  });

  it('rejects an empty archive', async () => {
    await expect(openTakeout(await new JSZip().generateAsync({ type: 'blob' }))).rejects.toBeInstanceOf(
      TakeoutError,
    );
  });

  it('rejects an archive with no product folders', async () => {
    await expect(openTakeout(await zipOf({ 'notes.txt': 'hello' }))).rejects.toThrow(/product folders/);
  });
});

/**
 * The reason this module reads with zip.js rather than JSZip: a Takeout export
 * is measured in gigabytes and must never be held in memory to be read. These
 * are the properties that buys, so they are the ones worth pinning down.
 */
describe('openTakeout memory behaviour', () => {
  it('reads only the directory at the tail when opening, not the archive', async () => {
    const { blob, read } = counting(
      await zipOf({
        'Takeout/Drive/a.bin': incompressible(300_000),
        'Takeout/Drive/b.bin': incompressible(300_000),
      }),
    );

    const archive = await openTakeout(blob);

    // Opening costs a fixed tail read (zip.js looks for the end-of-central-
    // directory record) — a fraction of the archive, and the same fraction
    // however much bigger the archive gets.
    expect(read()).toBeLessThan(blob.size / 4);
    expect(archive.product('Drive')!.entries).toHaveLength(2);
    await archive.close();
  });

  it('reads an entry’s bytes only when that entry is asked for', async () => {
    const { blob, read } = counting(
      await zipOf({
        'Takeout/Drive/a.bin': incompressible(300_000),
        'Takeout/Drive/b.bin': incompressible(300_000),
      }),
    );

    const archive = await openTakeout(blob);
    const afterOpen = read();
    await archive.product('Drive')!.entries[0].blob();

    // One entry read costs one entry's worth of bytes: the second file is
    // still untouched, which is what keeps a 20 GB export importable.
    const cost = read() - afterOpen;
    expect(cost).toBeGreaterThanOrEqual(300_000);
    expect(cost).toBeLessThan(400_000);
    await archive.close();
  });

  it('takes the entry size from the directory, without reading the entry', async () => {
    const { blob, read } = counting(await zipOf({ 'Takeout/Drive/a.bin': incompressible(300_000) }));
    const archive = await openTakeout(blob);

    expect(archive.product('Drive')!.entries[0].size).toBe(300_000);
    expect(read()).toBeLessThan(300_000);
    await archive.close();
  });

  it('lets an entry be read more than once', async () => {
    // The Keep importer sniffs a note to identify the directory, then reads it
    // again to convert it.
    const archive = await openTakeout(await zipOf({ 'Takeout/Keep/a.json': '{"a":1}' }));
    const entry = archive.product('Keep')!.entries[0];

    await expect(entry.text()).resolves.toBe('{"a":1}');
    await expect(entry.text()).resolves.toBe('{"a":1}');
    await archive.close();
  });

  it('closes cleanly, and closing twice is not an error', async () => {
    const archive = await openTakeout(await zipOf({ 'Takeout/Keep/a.json': '{}' }));
    await expect(archive.close()).resolves.toBeUndefined();
    await expect(archive.close()).resolves.toBeUndefined();
  });
});
