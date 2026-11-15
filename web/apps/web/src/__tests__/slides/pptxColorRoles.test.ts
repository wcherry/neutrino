/**
 * A slide's colours come from roles (`bg1`, `tx1`, …) that the master's `<p:clrMap>` maps onto
 * theme slots (`lt1`, `dk1`, …). The importer used to know only the slots, so `bg1` — the usual
 * background of PowerPoint's own layouts — resolved to its black fallback and decks opened black.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import JSZip from 'jszip';
import { importFromPptx } from '@/app/(apps)/slides/editor/pptxImport';

const FIXTURE = path.resolve(__dirname, '../../../../../../e2e/fixtures/sample.pptx');

async function deck(edit?: (zip: JSZip) => Promise<void>): Promise<File> {
  const zip = await JSZip.loadAsync(fs.readFileSync(FIXTURE));
  if (edit) await edit(zip);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return new File([bytes.buffer as ArrayBuffer], 'deck.pptx');
}

describe('pptx colour roles', () => {
  it('reads a bg1 background as the theme light colour (white), not black', async () => {
    const p = await importFromPptx(await deck());
    expect(p.slides[0].background).toEqual({ type: 'color', value: '#ffffff' });
  });

  it('follows the master colour map when it swaps the roles', async () => {
    const p = await importFromPptx(
      await deck(async (zip) => {
        const name = Object.keys(zip.files).find((n) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(n))!;
        const xml = await zip.file(name)!.async('text');
        zip.file(name, xml.replace('bg1="lt1"', 'bg1="dk1"'));
      }),
    );
    expect(p.slides[0].background).toEqual({ type: 'color', value: '#000000' });
  });
});
