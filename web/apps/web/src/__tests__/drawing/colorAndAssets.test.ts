/**
 * Colour and asset management — redesign phase 7.
 *
 * Two halves, and each has one thing that has to be exactly right.
 *
 * **An embedded ICC profile is bytes spliced into a PNG.** A chunk with a wrong
 * CRC or in the wrong place is not a slightly odd file — strict decoders refuse
 * the image outright, so a metadata mistake costs the picture. The chunk
 * framing, the CRC and the insertion point are checked against the format
 * rather than against what this writer happens to produce.
 *
 * **An asset is provenance, not a second copy of the image.** The rule the
 * model turns on is that the layer's own pixels *are* the embedded fallback, so
 * the test that matters is the one asserting a `data:` source never lands in an
 * asset row — the moment it does, every embedded picture is in the document
 * twice.
 */

import { describe, it, expect } from 'vitest';

import {
  buildChunk,
  buildIccpData,
  crc32,
  embedIccProfile,
  hasChunk,
  insertAfterIhdr,
  isPng,
  pngBitDepth,
  readChunks,
} from '../../app/(apps)/drawing/editor/io/png/chunks';
import { iccBytesFromDataUrl, iccDataUrl, parseIccProfile } from '../../app/(apps)/drawing/editor/io/icc';
import {
  createAsset,
  describeAssetSource,
  hashDataUrl,
  hashString,
  isReloadableUri,
} from '../../app/(apps)/drawing/editor/document/assets';
import { describeProfile, workingSpace } from '../../app/(apps)/drawing/editor/document/color';
import { createDocument, createRasterLayer } from '../../app/(apps)/drawing/editor/document/factory';
import { addNode, attachAsset, deleteNode, setColorProfile, setHdr } from '../../app/(apps)/drawing/editor/document/edits';
import { parseDocument, serializeDocument } from '../../app/(apps)/drawing/editor/document/serialize';
import { findNode } from '../../app/(apps)/drawing/editor/document/tree';
import { buildManifest } from '../../app/(apps)/drawing/editor/io/ora/manifest';

// ---------------------------------------------------------------------------
// PNG chunks
// ---------------------------------------------------------------------------

/** The smallest thing that is structurally a PNG: signature, IHDR, IEND. */
function tinyPng(bitDepth = 8): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 1, false);
  view.setUint32(4, 1, false);
  ihdr[8] = bitDepth;
  ihdr[9] = 6; // RGBA
  const chunks = [buildChunk('IHDR', ihdr), buildChunk('IDAT', new Uint8Array([1, 2, 3])), buildChunk('IEND', new Uint8Array(0))];
  const size = 8 + chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(size);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  let at = 8;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

describe('PNG chunks', () => {
  it('computes the CRC the format specifies', () => {
    // The known answer for "IEND" with no data, from the PNG specification's
    // own example. A CRC that is merely self-consistent would pass every test
    // written against this implementation and be rejected by every decoder.
    const iend = buildChunk('IEND', new Uint8Array(0));
    const crc = new DataView(iend.buffer).getUint32(8, false);
    expect(crc).toBe(0xae426082);
  });

  it('covers the type and the data but not the length', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const chunk = buildChunk('tEXt', data);
    const expected = crc32(new Uint8Array([...'tEXt'].map((c) => c.charCodeAt(0)).concat([...data])));
    expect(new DataView(chunk.buffer).getUint32(8 + data.length, false)).toBe(expected);
  });

  it('reads the chunk sequence back', () => {
    const chunks = readChunks(tinyPng())!;
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('refuses bytes that are not a PNG', () => {
    expect(isPng(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(readChunks(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(pngBitDepth(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('reads the source bit depth out of the IHDR', () => {
    // The only moment the depth exists: a browser decodes a 16-bit PNG to eight
    // bits per channel and there is no way to ask afterwards.
    expect(pngBitDepth(tinyPng(8))).toBe(8);
    expect(pngBitDepth(tinyPng(16))).toBe(16);
  });

  it('inserts a chunk after IHDR and before IDAT', () => {
    // Both halves are required: IHDR must be first, and anything describing how
    // to interpret the pixels must precede them.
    const withChunk = insertAfterIhdr(tinyPng(), buildChunk('gAMA', new Uint8Array([0, 1, 2, 3])))!;
    expect(readChunks(withChunk)!.map((c) => c.type)).toEqual(['IHDR', 'gAMA', 'IDAT', 'IEND']);
  });

  it('frames an iCCP chunk as a name, a null, the method and the profile', () => {
    const data = buildIccpData('Display P3', new Uint8Array([9, 9]));
    expect(String.fromCharCode(...data.subarray(0, 10))).toBe('Display P3');
    expect(data[10]).toBe(0);
    expect(data[11]).toBe(0); // zlib is the only defined compression method
    expect([...data.subarray(12)]).toEqual([9, 9]);
  });

  it('trims a profile name to what the format allows', () => {
    // A decoder may reject a chunk whose name breaks the grammar, which would
    // cost the profile rather than the stray character.
    const data = buildIccpData('a'.repeat(200), new Uint8Array([0]));
    expect(data.indexOf(0)).toBe(79);
  });

  it('embeds a profile once and refuses to embed a second', () => {
    const embedded = embedIccProfile(tinyPng(), 'sRGB', new Uint8Array([1, 2, 3]))!;
    expect(hasChunk(embedded, 'iCCP')).toBe(true);
    // A PNG may legally hold one iCCP; a second would make the file invalid.
    expect(embedIccProfile(embedded, 'sRGB', new Uint8Array([4]))).toBe(embedded);
  });

  it('reports rather than corrupts when the bytes are not a PNG', () => {
    expect(embedIccProfile(new Uint8Array([1, 2]), 'sRGB', new Uint8Array([1]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ICC
// ---------------------------------------------------------------------------

/** A minimal but structurally valid v2 profile whose `desc` tag says `name`. */
function iccProfile(name: string): Uint8Array {
  const desc = new Uint8Array(12 + name.length + 1);
  const descView = new DataView(desc.buffer);
  desc.set([...'desc'].map((c) => c.charCodeAt(0)), 0);
  descView.setUint32(8, name.length + 1, false);
  desc.set([...name].map((c) => c.charCodeAt(0)), 12);

  const tagTableSize = 4 + 12;
  const size = 128 + tagTableSize + desc.length;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, size, false);
  bytes[8] = 2; // version major
  bytes.set([...'RGB '].map((c) => c.charCodeAt(0)), 16);
  bytes.set([...'acsp'].map((c) => c.charCodeAt(0)), 36);
  view.setUint32(128, 1, false); // one tag
  bytes.set([...'desc'].map((c) => c.charCodeAt(0)), 132);
  view.setUint32(136, 128 + tagTableSize, false);
  view.setUint32(140, desc.length, false);
  bytes.set(desc, 128 + tagTableSize);
  return bytes;
}

describe('ICC profiles', () => {
  it('reads the profile description as its name', () => {
    const profile = parseIccProfile(iccProfile('Adobe RGB (1998)'))!;
    expect(profile.name).toBe('Adobe RGB (1998)');
    expect(profile.colorSpace).toBe('RGB ');
    expect(profile.version).toBe(2);
  });

  it('refuses anything without the acsp signature', () => {
    // Without this, "Embed ICC profile…" would accept a JPEG and write it into
    // every PNG the document exports.
    const notAProfile = new Uint8Array(200);
    expect(parseIccProfile(notAProfile)).toBeNull();
  });

  it('refuses a profile truncated below its declared size', () => {
    const full = iccProfile('sRGB');
    expect(parseIccProfile(full.subarray(0, full.length - 10))).toBeNull();
  });

  it('round-trips through a data URL', () => {
    const bytes = iccProfile('Display P3');
    const back = iccBytesFromDataUrl(iccDataUrl(bytes))!;
    expect([...back]).toEqual([...bytes]);
  });

  it('does not read an arbitrary data URL as a profile', () => {
    expect(iccBytesFromDataUrl('data:image/png;base64,AAAA')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The colour profile on a document
// ---------------------------------------------------------------------------

describe('the document colour profile', () => {
  it('round-trips the space, depth, HDR block and embedded profile', () => {
    const uri = iccDataUrl(iccProfile('Display P3'));
    const doc = setHdr(
      setColorProfile(createDocument(), { space: 'display-p3', name: 'Display P3', iccUri: uri, bitDepth: 16 }),
      { enabled: true, transfer: 'hlg', headroom: 4 },
    );

    const reopened = parseDocument(serializeDocument(doc))!;
    expect(reopened.colorProfile.space).toBe('display-p3');
    expect(reopened.colorProfile.bitDepth).toBe(16);
    expect(reopened.colorProfile.iccUri).toBe(uri);
    expect(reopened.colorProfile.hdr).toEqual({ enabled: true, transfer: 'hlg', headroom: 4 });
  });

  it('drops an iccUri that is not an ICC data URL', () => {
    // A document is not a place from which to fetch things; an `iccUri`
    // pointing at somebody's server would be a request made on opening a file.
    const raw = JSON.stringify({
      ...createDocument(),
      colorProfile: { name: 'Evil', iccUri: 'https://example.com/profile.icc' },
    });
    expect(parseDocument(raw)!.colorProfile.iccUri).toBeUndefined();
  });

  it('falls back to sRGB for a space it does not recognise', () => {
    const raw = JSON.stringify({ ...createDocument(), colorProfile: { name: 'x', space: 'rec2020' } });
    expect(workingSpace(parseDocument(raw)!.colorProfile)).toBe('srgb');
  });

  it('describes what actually travels with the file', () => {
    const doc = setColorProfile(createDocument(), { name: 'Display P3', iccUri: 'data:application/vnd.iccprofile;base64,AA' });
    expect(describeProfile(doc.colorProfile)).toContain('ICC embedded');
    expect(describeProfile(createDocument().colorProfile)).not.toContain('ICC embedded');
  });

  it('names the merged image as the SDR preview when HDR is declared', () => {
    // OpenRaster's merged image is PNG-based and therefore SDR. A reader that
    // cannot show HDR has to be told which entry to show instead.
    const doc = setHdr(createDocument(), { enabled: true, headroom: 3 });
    const manifest = buildManifest(doc, new Map(), new Map());
    expect(manifest.color.hdr).toEqual({ transfer: 'pq', headroom: 3, sdrPreview: 'mergedimage.png' });
  });

  it('has no HDR block when HDR is off', () => {
    expect(buildManifest(createDocument(), new Map(), new Map()).color.hdr).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

const PIXELS = 'data:image/png;base64,AAECAwQ=';

describe('linked assets', () => {
  it('hashes deterministically and distinguishes different bytes', () => {
    expect(hashDataUrl(PIXELS)).toBe(hashDataUrl(PIXELS));
    expect(hashDataUrl(PIXELS)).not.toBe(hashDataUrl('data:image/png;base64,BBECAwQ='));
    expect(hashString('')).toHaveLength(8);
  });

  it('never stores a data URI as the source', () => {
    // The rule the whole module turns on: a `data:` URI *is* the image, so
    // keeping it here would put a second copy of every embedded picture in the
    // document. The name stands in for it.
    const asset = createAsset({ uri: PIXELS, name: 'Sketch.png', dataUrl: PIXELS, width: 4, height: 4 });
    expect(asset.uri).toBe('Sketch.png');
    expect(asset.linked).toBe(false);
  });

  it('marks a fetchable source as linked and anything else as not', () => {
    expect(isReloadableUri('https://example.com/a.png')).toBe(true);
    expect(isReloadableUri('neutrino-drive:abc')).toBe(true);
    expect(isReloadableUri('data:image/png;base64,AA')).toBe(false);
    expect(isReloadableUri('photo.jpg')).toBe(false);
  });

  it('names the source in a way a person can read', () => {
    const drive = createAsset({ uri: 'neutrino-drive:abc', name: 'A', dataUrl: PIXELS, width: 1, height: 1 });
    const web = createAsset({ uri: 'https://images.example.com/deep/path.png', name: 'B', dataUrl: PIXELS, width: 1, height: 1 });
    expect(describeAssetSource(drive)).toBe('Neutrino Drive');
    expect(describeAssetSource(web)).toBe('images.example.com');
  });

  it('attaches to a layer and survives a save', () => {
    const layer = createRasterLayer({ dataUrl: PIXELS, width: 4, height: 4, x: 0, y: 0 }, 'Photo');
    const asset = createAsset({ uri: 'https://example.com/a.png', name: 'a.png', dataUrl: PIXELS, width: 4, height: 4 });
    const doc = attachAsset(addNode(createDocument(), layer), layer.id, asset);

    const reopened = parseDocument(serializeDocument(doc))!;
    expect(reopened.assets).toHaveLength(1);
    const restored = findNode(reopened.root, layer.id);
    expect(restored?.type === 'raster' && restored.assetId).toBe(asset.id);
  });

  it('prunes provenance for a layer that is gone', () => {
    // Where an image came from is a fact about a picture that is in the
    // drawing. Deleting the layer leaves nothing for the row to describe.
    const layer = createRasterLayer({ dataUrl: PIXELS, width: 4, height: 4, x: 0, y: 0 }, 'Photo');
    const asset = createAsset({ uri: 'https://example.com/a.png', name: 'a.png', dataUrl: PIXELS, width: 4, height: 4 });
    const doc = attachAsset(addNode(createDocument(), layer), layer.id, asset);

    const reopened = parseDocument(serializeDocument(deleteNode(doc, layer.id)))!;
    expect(reopened.assets).toBeUndefined();
  });

  it('re-derives whether a stored asset can be reloaded', () => {
    // A stored `linked: true` beside a local filename would offer a Reload
    // button that can only fail.
    const raw = JSON.stringify({
      ...createDocument(),
      assets: [{ id: 'a', uri: 'holiday.png', name: 'holiday.png', hash: 'x', width: 2, height: 2, linked: true }],
    });
    expect(parseDocument(raw)!.assets?.[0].linked).toBe(false);
  });

  it('drops an asset row with no source at all', () => {
    const raw = JSON.stringify({ ...createDocument(), assets: [{ id: 'a', name: 'x' }] });
    expect(parseDocument(raw)!.assets).toBeUndefined();
  });

  it('records a 16-bit source on the layer that carried one', () => {
    const raw = JSON.stringify({
      ...createDocument(),
      root: {
        type: 'stack', name: 'Root', children: [{
          type: 'raster', id: 'r1', name: 'Deep',
          source: { dataUrl: PIXELS, width: 2, height: 2, x: 0, y: 0, bitDepth: 16 },
        }],
      },
    });
    const layer = findNode(parseDocument(raw)!.root, 'r1');
    expect(layer?.type === 'raster' && layer.source.bitDepth).toBe(16);
  });
});
