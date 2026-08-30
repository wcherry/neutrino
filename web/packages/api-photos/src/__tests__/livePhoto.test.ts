import { describe, it, expect } from 'vitest';
import {
  CONTENT_IDENTIFIER_KEY,
  STILL_IMAGE_TIME_KEY,
  isLikelyLivePhotoMov,
  livePhotoStem,
  pairLivePhotos,
  readLivePhotoInfo,
  readQuickTimeMetadata,
} from '../livePhoto';
import type { PhotoResponse } from '../index';

// ---------------------------------------------------------------------------
// A QuickTime file, built by hand
// ---------------------------------------------------------------------------

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** `[size][type][body]`, the shape of every QuickTime atom. */
function atom(type: string, body: number[]): number[] {
  return [...u32(body.length + 8), ...ascii(type), ...body];
}

/** A `keys` atom listing metadata key names in the `mdta` namespace. */
function keysAtom(keys: string[]): number[] {
  const entries = keys.flatMap((key) => [
    ...u32(key.length + 8),
    ...ascii('mdta'),
    ...ascii(key),
  ]);
  return atom('keys', [...u32(0), ...u32(keys.length), ...entries]);
}

/** One `ilst` entry: a 1-based index into `keys`, wrapping a typed `data` atom. */
function ilstEntry(index: number, wellKnownType: number, payload: number[]): number[] {
  const data = atom('data', [...u32(wellKnownType), ...u32(0), ...payload]);
  return [...u32(data.length + 8), ...u32(index), ...data];
}

function movieBlob(
  entries: Array<{ key: string; type: number; payload: number[] }>,
  opts: { isoMeta?: boolean; trailingMoov?: boolean } = {},
): Blob {
  const keys = entries.map((e) => e.key);
  const ilst = atom(
    'ilst',
    entries.flatMap((e, i) => ilstEntry(i + 1, e.type, e.payload)),
  );
  // ISO-BMFF puts four bytes of version/flags at the head of `meta`; QuickTime,
  // which is what Apple writes, does not.
  const metaBody = [...(opts.isoMeta ? u32(0) : []), ...keysAtom(keys), ...ilst];
  const moov = atom('moov', atom('meta', metaBody));
  const ftyp = atom('ftyp', ascii('qt  ').concat(u32(0)));
  const mdat = atom('mdat', new Array(64).fill(0));
  const bytes = opts.trailingMoov
    ? [...ftyp, ...mdat, ...moov]
    : [...ftyp, ...moov, ...mdat];
  return new Blob([new Uint8Array(bytes)]);
}

const IDENTIFIER = '9F4B0F2E-9A1B-4C71-8E0A-3C2D5E6F7A8B';

function livePhotoMov(opts?: { isoMeta?: boolean; trailingMoov?: boolean }): Blob {
  return movieBlob(
    [
      { key: CONTENT_IDENTIFIER_KEY, type: 1, payload: ascii(IDENTIFIER) },
      { key: STILL_IMAGE_TIME_KEY, type: 21, payload: [0, 0, 0, 1] },
    ],
    opts,
  );
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe('readQuickTimeMetadata', () => {
  it('reads keyed metadata out of a QuickTime moov atom', async () => {
    const meta = await readQuickTimeMetadata(livePhotoMov());
    expect(meta).toEqual({
      [CONTENT_IDENTIFIER_KEY]: IDENTIFIER,
      [STILL_IMAGE_TIME_KEY]: 1,
    });
  });

  it('finds a moov atom that sits after the media data', async () => {
    const meta = await readQuickTimeMetadata(livePhotoMov({ trailingMoov: true }));
    expect(meta?.[CONTENT_IDENTIFIER_KEY]).toBe(IDENTIFIER);
  });

  it('reads an ISO-BMFF meta atom, which carries version/flags QuickTime does not', async () => {
    const meta = await readQuickTimeMetadata(livePhotoMov({ isoMeta: true }));
    expect(meta?.[CONTENT_IDENTIFIER_KEY]).toBe(IDENTIFIER);
  });

  it('returns null for a file that is not QuickTime at all', async () => {
    const meta = await readQuickTimeMetadata(new Blob([new Uint8Array(64).fill(7)]));
    expect(meta).toBeNull();
  });

  it('returns null rather than throwing on a truncated moov', async () => {
    const full = new Uint8Array(await livePhotoMov({ trailingMoov: true }).arrayBuffer());
    const meta = await readQuickTimeMetadata(new Blob([full.subarray(0, full.length - 40)]));
    expect(meta).toBeNull();
  });
});

describe('isLikelyLivePhotoMov', () => {
  it('accepts every spelling of the content identifier field', () => {
    expect(isLikelyLivePhotoMov({ [CONTENT_IDENTIFIER_KEY]: IDENTIFIER })).toBe(true);
    expect(isLikelyLivePhotoMov({ 'quicktime:ContentIdentifier': IDENTIFIER })).toBe(true);
    expect(isLikelyLivePhotoMov({ 'Content Identifier': IDENTIFIER })).toBe(true);
    expect(isLikelyLivePhotoMov({ ContentIdentifier: IDENTIFIER })).toBe(true);
  });

  it('rejects metadata without one', () => {
    expect(isLikelyLivePhotoMov({ 'com.apple.quicktime.make': 'Apple' })).toBe(false);
    expect(isLikelyLivePhotoMov({})).toBe(false);
  });
});

describe('readLivePhotoInfo', () => {
  it('returns the identifier and still-image time', async () => {
    expect(await readLivePhotoInfo(livePhotoMov())).toEqual({
      contentIdentifier: IDENTIFIER,
      stillImageTime: 1,
    });
  });

  it('drops the still-image time when Apple wrote the -1 placeholder', async () => {
    const blob = movieBlob([
      { key: CONTENT_IDENTIFIER_KEY, type: 1, payload: ascii(IDENTIFIER) },
      { key: STILL_IMAGE_TIME_KEY, type: 21, payload: [0xff, 0xff, 0xff, 0xff] },
    ]);
    expect(await readLivePhotoInfo(blob)).toEqual({ contentIdentifier: IDENTIFIER });
  });

  it('returns null for an ordinary movie', async () => {
    const blob = movieBlob([
      { key: 'com.apple.quicktime.make', type: 1, payload: ascii('Apple') },
    ]);
    expect(await readLivePhotoInfo(blob)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

describe('livePhotoStem', () => {
  it('reduces both halves of a Live Photo to the same stem', () => {
    expect(livePhotoStem('IMG_1234.HEIC')).toBe('img_1234');
    expect(livePhotoStem('IMG_1234.MOV')).toBe('img_1234');
  });

  it("drops Takeout's copy suffix", () => {
    expect(livePhotoStem('IMG_1234(1).JPG')).toBe('img_1234');
  });

  it('ignores a leading path', () => {
    expect(livePhotoStem('Google Photos/2019/IMG_1234.MP4')).toBe('img_1234');
  });
});

let nextId = 0;
function photo(fileName: string, mimeType: string, metadata?: PhotoResponse['metadata']): PhotoResponse {
  const id = `p${++nextId}`;
  return {
    id,
    fileId: id,
    fileName,
    mimeType,
    sizeBytes: 1000,
    contentUrl: `/api/v1/drive/files/${id}`,
    thumbnail: null,
    thumbnailMimeType: null,
    isStarred: false,
    isArchived: false,
    captureDate: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    deletedAt: null,
    metadata: metadata ?? null,
  };
}

describe('pairLivePhotos', () => {
  it('folds a motion candidate into the still it shares a name with', () => {
    const still = photo('IMG_1234.HEIC', 'image/heic');
    const clip = photo('IMG_1234.MOV', 'video/quicktime');

    const items = pairLivePhotos([still], [clip]);

    expect(items).toHaveLength(1);
    expect(items[0].photo).toBe(still);
    expect(items[0].motion).toBe(clip);
    expect(items[0].isLive).toBe(true);
  });

  it('drops an ordinary video pulled in only as a candidate', () => {
    const items = pairLivePhotos(
      [photo('IMG_1234.HEIC', 'image/heic')],
      [photo('holiday.mp4', 'video/mp4')],
    );

    expect(items).toHaveLength(1);
    expect(items[0].motion).toBeNull();
    expect(items[0].isLive).toBe(false);
  });

  it('stops a listed clip showing as its own tile once it is paired', () => {
    const still = photo('IMG_9.JPG', 'image/jpeg');
    const clip = photo('IMG_9.MOV', 'video/quicktime');

    const items = pairLivePhotos([still, clip]);

    expect(items.map((i) => i.photo.id)).toEqual([still.id]);
    expect(items[0].motion).toBe(clip);
  });

  it('keeps an unpaired ordinary video that the listing itself returned', () => {
    const video = photo('holiday.mp4', 'video/mp4');

    const items = pairLivePhotos([video]);

    expect(items).toHaveLength(1);
    expect(items[0].photo).toBe(video);
    expect(items[0].isLive).toBe(false);
  });

  it('prefers the content identifier over the filename', () => {
    const meta = { livePhoto: { contentIdentifier: IDENTIFIER } };
    const still = photo('renamed-still.heic', 'image/heic', meta);
    const decoy = photo('IMG_1234.HEIC', 'image/heic');
    const clip = photo('IMG_1234.MOV', 'video/quicktime', meta);

    const items = pairLivePhotos([decoy, still], [clip]);

    expect(items.find((i) => i.photo.id === still.id)?.motion).toBe(clip);
    expect(items.find((i) => i.photo.id === decoy.id)?.motion).toBeNull();
  });

  it('gives a Live Photo clip whose still is missing a tile of its own', () => {
    const clip = photo('IMG_1234.MOV', 'video/quicktime', {
      livePhoto: { contentIdentifier: IDENTIFIER },
    });

    const items = pairLivePhotos([], [clip]);

    expect(items).toEqual([{ photo: clip, motion: null, isLive: true }]);
  });

  it('never gives one still two clips', () => {
    const still = photo('IMG_1234.JPG', 'image/jpeg');
    const first = photo('IMG_1234.MOV', 'video/quicktime');
    const second = photo('IMG_1234.mp4', 'video/mp4');

    const items = pairLivePhotos([still], [first, second]);

    expect(items).toHaveLength(1);
    expect(items[0].motion).toBe(first);
  });

  it('preserves the order of the listing it was given', () => {
    const a = photo('a.jpg', 'image/jpeg');
    const b = photo('b.jpg', 'image/jpeg');
    const c = photo('c.jpg', 'image/jpeg');

    expect(pairLivePhotos([c, a, b]).map((i) => i.photo.id)).toEqual([c.id, a.id, b.id]);
  });
});
