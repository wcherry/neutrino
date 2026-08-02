/**
 * Tests for reading a Takeout zip (`lib/takeout/archive.ts`).
 *
 * The archives are built with JSZip rather than checked in as binaries, so the
 * layout each test depends on is visible in the test.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { openTakeout, TakeoutError } from '@/lib/takeout/archive';

async function zipOf(files: Record<string, string>): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: 'blob' });
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
