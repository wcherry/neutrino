/**
 * The OOXML container (issue #127).
 *
 * A native document is a real `.docx`/`.xlsx`/`.pptx` now, and the editors'
 * OOXML writers are lossy — no charts, no footnotes, no themes. So a package
 * carries the editor's own model beside the OOXML parts and prefers it on open.
 * These tests pin down the three things that has to get right:
 *
 *  - a model written into a package comes back out of it unchanged;
 *  - the package stays a valid OPC package, which means `[Content_Types].xml`
 *    declares the extension of every part in it, `.json` included;
 *  - a model is ignored the moment it stops describing the package it sits in,
 *    because a stale model silently overwriting an outside edit is worse than
 *    re-parsing the OOXML.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  NEUTRINO_MODEL_PART,
  looksLikeOoxml,
  packNeutrinoModel,
  readNeutrinoModel,
} from '@/lib/ooxmlContainer';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

/** A stand-in for what `buildDocxBlob` produces: a zip with the usual parts. */
async function fakeDocx(bodyText = 'Hello'): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', '<Relationships/>');
  zip.file('word/document.xml', `<w:document><w:t>${bodyText}</w:t></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}

const MODEL = JSON.stringify({
  doc: { type: 'doc', content: [{ type: 'paragraph' }] },
  _meta: { pageSetup: { pageSize: 'a4' } },
});

describe('looksLikeOoxml', () => {
  it('accepts a zip local file header', async () => {
    expect(looksLikeOoxml(await fakeDocx())).toBe(true);
  });

  it('rejects bytes that are not a zip', () => {
    expect(looksLikeOoxml(new TextEncoder().encode('{"type":"doc"}'))).toBe(false);
  });

  it('rejects bytes too short to have a header at all', () => {
    expect(looksLikeOoxml(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });
});

describe('packNeutrinoModel / readNeutrinoModel', () => {
  it('gives the model back exactly as it went in', async () => {
    const packed = await packNeutrinoModel(await fakeDocx(), 'docs', MODEL);

    expect(await readNeutrinoModel(packed, 'docs')).toBe(MODEL);
  });

  it('leaves the OOXML parts untouched, so the file still opens in Word', async () => {
    const packed = await packNeutrinoModel(await fakeDocx('Report'), 'docs', MODEL);

    const zip = await JSZip.loadAsync(packed);
    expect(await zip.file('word/document.xml')!.async('string')).toContain('Report');
    expect(zip.file('_rels/.rels')).not.toBeNull();
  });

  it('declares the model part’s extension in [Content_Types].xml', async () => {
    const packed = await packNeutrinoModel(await fakeDocx(), 'docs', MODEL);

    const zip = await JSZip.loadAsync(packed);
    const types = await zip.file('[Content_Types].xml')!.async('string');
    // An undeclared extension makes the whole package malformed — Word refuses
    // to open it rather than ignoring the part it does not recognise.
    expect(types).toContain('Extension="json"');
    // …and the parts that were already declared must survive.
    expect(types).toContain('PartName="/word/document.xml"');
  });

  it('adds the json content type once, however often the package is repacked', async () => {
    const once = await packNeutrinoModel(await fakeDocx(), 'docs', MODEL);
    const twice = await packNeutrinoModel(once, 'docs', MODEL);

    const types = await (await JSZip.loadAsync(twice)).file('[Content_Types].xml')!.async('string');
    expect(types.match(/Extension="json"/g)).toHaveLength(1);
  });

  it('replaces the previous model rather than stacking a second one', async () => {
    const once = await packNeutrinoModel(await fakeDocx(), 'docs', MODEL);
    const twice = await packNeutrinoModel(once, 'docs', '{"doc":"newer"}');

    expect(await readNeutrinoModel(twice, 'docs')).toBe('{"doc":"newer"}');
  });
});

describe('readNeutrinoModel — when the model must not be trusted', () => {
  it('returns null for a package with no model, as one from Word has', async () => {
    expect(await readNeutrinoModel(await fakeDocx(), 'docs')).toBeNull();
  });

  it('returns null for bytes that are not a package at all', async () => {
    const notAZip = new TextEncoder().encode('not a zip');
    expect(await readNeutrinoModel(notAZip, 'docs')).toBeNull();
  });

  /**
   * A `.pptx` opened by the Docs editor would be a routing bug, but reading a
   * presentation model into a text editor would turn that into a corrupted
   * save. Cheap to rule out, so it is ruled out.
   */
  it('returns null when the model belongs to a different editor', async () => {
    const packed = await packNeutrinoModel(await fakeDocx(), 'slides', MODEL);

    expect(await readNeutrinoModel(packed, 'docs')).toBeNull();
  });

  /**
   * The case the digest exists for. Word and LibreOffice drop the model part
   * when they save, which lands on the "no model" path above — but a tool that
   * keeps it while rewriting the document would leave a model describing a
   * version of the file that no longer exists, and preferring it would throw
   * away the outside edit.
   */
  it('returns null when another tool rewrote a part behind the model’s back', async () => {
    const packed = await packNeutrinoModel(await fakeDocx('Hello'), 'docs', MODEL);

    const zip = await JSZip.loadAsync(packed);
    zip.file('word/document.xml', '<w:document><w:t>Edited elsewhere</w:t></w:document>');
    const tampered = await zip.generateAsync({ type: 'uint8array' });

    expect(await readNeutrinoModel(tampered, 'docs')).toBeNull();
  });

  it('returns null when a part was added behind the model’s back', async () => {
    const packed = await packNeutrinoModel(await fakeDocx(), 'docs', MODEL);

    const zip = await JSZip.loadAsync(packed);
    zip.file('word/comments.xml', '<w:comments/>');
    const tampered = await zip.generateAsync({ type: 'uint8array' });

    expect(await readNeutrinoModel(tampered, 'docs')).toBeNull();
  });

  it('survives a repack that changes compression but no content', async () => {
    const packed = await packNeutrinoModel(await fakeDocx(), 'docs', MODEL);

    // Same parts, same bytes, different zip encoding — the digest is over the
    // parts, not over the archive, so this must still read.
    const repacked = await (await JSZip.loadAsync(packed))
      .generateAsync({ type: 'uint8array', compression: 'STORE' });

    expect(await readNeutrinoModel(repacked, 'docs')).toBe(MODEL);
  });

  it('returns null for a model part holding something other than an envelope', async () => {
    const zip = await JSZip.loadAsync(await fakeDocx());
    zip.file(NEUTRINO_MODEL_PART, 'not json');
    const bogus = await zip.generateAsync({ type: 'uint8array' });

    expect(await readNeutrinoModel(bogus, 'docs')).toBeNull();
  });
});
