import { describe, it, expect } from 'vitest';
import {
  CONTENT_IDENTIFIER_KEY,
  STILL_IMAGE_TIME_KEY,
  isLikelyLivePhotoMov,
  motionPhotoLabel,
  motionPhotoStem,
  pairMotionPhotos,
  readMotionPhotoInfo,
  stillFrameSeconds,
} from '../motionPhoto';
import { readQuickTimeMetadata } from '../quicktime';
import { findXmpInJpeg, readGCameraMotion, xmpValue } from '../xmp';
import type { PhotoResponse } from '../index';

// ---------------------------------------------------------------------------
// Files, built by hand
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

interface MovieOpts {
  isoMeta?: boolean;
  trailingMoov?: boolean;
  /** An XMP packet, in a top-level `uuid` box as Google writes it. */
  xmp?: string;
  /** Put the XMP in `moov/udta/XMP_` instead. */
  xmpInUdta?: boolean;
}

const XMP_UUID = [
  0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac,
];

function movieBlob(
  entries: Array<{ key: string; type: number; payload: number[] }>,
  opts: MovieOpts = {},
): Blob {
  const keys = entries.map((e) => e.key);
  const ilst = atom(
    'ilst',
    entries.flatMap((e, i) => ilstEntry(i + 1, e.type, e.payload)),
  );
  // ISO-BMFF puts four bytes of version/flags at the head of `meta`; QuickTime,
  // which is what Apple writes, does not.
  const metaBody = [...(opts.isoMeta ? u32(0) : []), ...keysAtom(keys), ...ilst];
  const moovBody = [
    ...(entries.length ? atom('meta', metaBody) : []),
    ...(opts.xmp && opts.xmpInUdta ? atom('udta', atom('XMP_', ascii(opts.xmp))) : []),
  ];
  const moov = atom('moov', moovBody);
  const ftyp = atom('ftyp', ascii('qt  ').concat(u32(0)));
  const mdat = atom('mdat', new Array(64).fill(0));
  const uuid =
    opts.xmp && !opts.xmpInUdta ? atom('uuid', [...XMP_UUID, ...ascii(opts.xmp)]) : [];
  const bytes = opts.trailingMoov
    ? [...ftyp, ...uuid, ...mdat, ...moov]
    : [...ftyp, ...uuid, ...moov, ...mdat];
  return new Blob([new Uint8Array(bytes)]);
}

const IDENTIFIER = '9F4B0F2E-9A1B-4C71-8E0A-3C2D5E6F7A8B';

function livePhotoMov(opts?: MovieOpts): Blob {
  return movieBlob(
    [
      { key: CONTENT_IDENTIFIER_KEY, type: 1, payload: ascii(IDENTIFIER) },
      { key: STILL_IMAGE_TIME_KEY, type: 21, payload: [0, 0, 0, 1] },
    ],
    opts,
  );
}

/** A JPEG with an APP1 XMP segment, and optionally an MP4 appended. */
function jpegBlob(xmp: string | null, opts: { appendMp4?: number } = {}): Blob {
  const bytes: number[] = [0xff, 0xd8];
  if (xmp !== null) {
    const payload = [...ascii('http://ns.adobe.com/xap/1.0/\0'), ...ascii(xmp)];
    const length = payload.length + 2;
    bytes.push(0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...payload);
  }
  // Start of scan, then some "image data".
  bytes.push(0xff, 0xda, 0x00, 0x02, ...new Array(32).fill(0x55));
  bytes.push(0xff, 0xd9);
  if (opts.appendMp4) {
    // A minimal MP4: an `ftyp` box padded out to the requested length.
    const padding = new Array(Math.max(0, opts.appendMp4 - 16)).fill(0);
    bytes.push(...u32(16), ...ascii('ftyp'), ...ascii('mp42'), ...u32(0), ...padding);
  }
  return new Blob([new Uint8Array(bytes)]);
}

const MOTION_PHOTO_XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:GCamera="http://ns.google.com/photos/1.0/camera/"
    xmlns:Container="http://ns.google.com/photos/1.0/container/"
    GCamera:MotionPhoto="1"
    GCamera:MotionPhotoVersion="1"
    GCamera:MotionPhotoPresentationTimestampUs="500000">
   <Container:Directory>
    <rdf:Seq>
     <rdf:li><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0"/></rdf:li>
     <rdf:li><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="64"/></rdf:li>
    </rdf:Seq>
   </Container:Directory>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

const MICRO_VIDEO_XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description
  GCamera:MicroVideo="1"
  GCamera:MicroVideoVersion="1"
  GCamera:MicroVideoOffset="64"
  GCamera:MicroVideoPresentationTimestampUs="250000"/></rdf:RDF></x:xmpmeta>`;

// ---------------------------------------------------------------------------
// QuickTime parsing
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

// ---------------------------------------------------------------------------
// XMP
// ---------------------------------------------------------------------------

describe('findXmpInJpeg', () => {
  it('pulls the packet out of an APP1 segment', async () => {
    const bytes = new Uint8Array(await jpegBlob(MOTION_PHOTO_XMP).arrayBuffer());
    expect(findXmpInJpeg(bytes)).toContain('GCamera:MotionPhoto');
  });

  it('returns null for a JPEG with no XMP', async () => {
    const bytes = new Uint8Array(await jpegBlob(null).arrayBuffer());
    expect(findXmpInJpeg(bytes)).toBeNull();
  });

  it('returns null for something that is not a JPEG', () => {
    expect(findXmpInJpeg(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});

describe('xmpValue', () => {
  it('reads a property written as an attribute', () => {
    expect(xmpValue('GCamera:MotionPhotoVersion="1"', 'GCamera:MotionPhotoVersion')).toBe('1');
  });

  it('reads the same property written as an element', () => {
    expect(
      xmpValue('<GCamera:MotionPhotoVersion>2</GCamera:MotionPhotoVersion>', 'GCamera:MotionPhotoVersion'),
    ).toBe('2');
  });

  it('returns null when it is absent', () => {
    expect(xmpValue('<x:xmpmeta/>', 'GCamera:MotionPhoto')).toBeNull();
  });
});

describe('readGCameraMotion', () => {
  it('reads a MotionPhoto v2 packet, taking the clip length from the container', () => {
    expect(readGCameraMotion(MOTION_PHOTO_XMP)).toEqual({
      signal: 'GCamera:MotionPhoto',
      version: 1,
      presentationTimestampUs: 500000,
      videoLengthFromEnd: 64,
    });
  });

  it('reads an older MicroVideo packet', () => {
    expect(readGCameraMotion(MICRO_VIDEO_XMP)).toEqual({
      signal: 'GCamera:MicroVideo',
      version: 1,
      presentationTimestampUs: 250000,
      videoLengthFromEnd: 64,
    });
  });

  it('reports the version as the signal when the flag itself is missing', () => {
    expect(readGCameraMotion('GCamera:MotionPhotoVersion="1"')?.signal).toBe(
      'GCamera:MotionPhotoVersion',
    );
  });

  it('returns null for a packet with no motion markers', () => {
    expect(readGCameraMotion('<x:xmpmeta><dc:creator>someone</dc:creator></x:xmpmeta>')).toBeNull();
  });

  it('does not take a flag that is explicitly off', () => {
    expect(readGCameraMotion('GCamera:MotionPhoto="0"')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

describe('readMotionPhotoInfo', () => {
  it('classifies an Apple Live Photo clip from its content identifier', async () => {
    expect(await readMotionPhotoInfo(livePhotoMov(), { fileName: 'IMG_1.MOV' })).toEqual({
      subtype: 'live_photo_apple',
      signal: CONTENT_IDENTIFIER_KEY,
      contentIdentifier: IDENTIFIER,
      stillImageTime: 1,
    });
  });

  it('drops the still-image time when Apple wrote the -1 placeholder', async () => {
    const blob = movieBlob([
      { key: CONTENT_IDENTIFIER_KEY, type: 1, payload: ascii(IDENTIFIER) },
      { key: STILL_IMAGE_TIME_KEY, type: 21, payload: [0xff, 0xff, 0xff, 0xff] },
    ]);
    expect(await readMotionPhotoInfo(blob, { fileName: 'IMG_1.MOV' })).toEqual({
      subtype: 'live_photo_apple',
      signal: CONTENT_IDENTIFIER_KEY,
      contentIdentifier: IDENTIFIER,
    });
  });

  it('classifies a Google Motion Photo exported as an mp4, from its XMP uuid box', async () => {
    const blob = movieBlob([], { xmp: MOTION_PHOTO_XMP });
    expect(await readMotionPhotoInfo(blob, { fileName: 'PXL_1.mp4' })).toEqual({
      subtype: 'motion_photo_google',
      signal: 'GCamera:MotionPhoto',
      presentationTimestampUs: 500000,
    });
  });

  it('finds the same XMP when it sits in moov/udta instead', async () => {
    const blob = movieBlob([], { xmp: MOTION_PHOTO_XMP, xmpInUdta: true });
    expect((await readMotionPhotoInfo(blob, { fileName: 'PXL_1.mp4' }))?.subtype).toBe(
      'motion_photo_google',
    );
  });

  it('classifies a Google Motion Photo jpeg and locates its embedded clip', async () => {
    const blob = jpegBlob(MOTION_PHOTO_XMP, { appendMp4: 64 });
    const info = await readMotionPhotoInfo(blob, { fileName: 'PXL_1.MP.jpg' });

    expect(info?.subtype).toBe('motion_photo_google');
    expect(info?.embedded).toEqual({ offset: blob.size - 64, length: 64 });
  });

  it('finds the embedded clip by scanning when the declared length is wrong', async () => {
    // A re-saved file whose XMP still claims the original length.
    const blob = jpegBlob(MOTION_PHOTO_XMP.replace('Item:Length="64"', 'Item:Length="999"'), {
      appendMp4: 64,
    });
    const info = await readMotionPhotoInfo(blob, { fileName: 'PXL_1.MP.jpg' });

    expect(info?.embedded).toEqual({ offset: blob.size - 64, length: 64 });
  });

  it('classifies a motion photo jpeg with no clip in it as a photo without motion', async () => {
    const info = await readMotionPhotoInfo(jpegBlob(MOTION_PHOTO_XMP), {
      fileName: 'PXL_1.MP.jpg',
    });

    expect(info?.subtype).toBe('motion_photo_google');
    expect(info?.embedded).toBeUndefined();
  });

  /** Requirement 5: ordinary videos must stay videos. */
  it('leaves an ordinary movie unclassified', async () => {
    const blob = movieBlob([{ key: 'com.apple.quicktime.make', type: 1, payload: ascii('Apple') }]);
    expect(await readMotionPhotoInfo(blob, { fileName: 'holiday.mp4' })).toBeNull();
  });

  it('leaves an ordinary jpeg unclassified', async () => {
    expect(await readMotionPhotoInfo(jpegBlob(null), { fileName: 'scan.jpg' })).toBeNull();
  });

  it('classifies on metadata, not on the extension', async () => {
    // The same bytes named as a movie and as something unknown: the metadata
    // decides, and a file the detector cannot open is simply not one.
    const blob = movieBlob([], { xmp: MOTION_PHOTO_XMP });
    expect((await readMotionPhotoInfo(blob, { fileName: 'clip.mov' }))?.subtype).toBe(
      'motion_photo_google',
    );
    expect(await readMotionPhotoInfo(blob, { fileName: 'notes.txt' })).toBeNull();
  });
});

describe('stillFrameSeconds', () => {
  it("uses Apple's still-image time as it is", () => {
    expect(
      stillFrameSeconds({ subtype: 'live_photo_apple', signal: 'x', stillImageTime: 1.5 }),
    ).toBe(1.5);
  });

  it("converts Google's microseconds", () => {
    expect(
      stillFrameSeconds({
        subtype: 'motion_photo_google',
        signal: 'x',
        presentationTimestampUs: 500000,
      }),
    ).toBe(0.5);
  });

  it('has no opinion when the file does not say', () => {
    expect(stillFrameSeconds({ subtype: 'motion_photo_google', signal: 'x' })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

describe('motionPhotoStem', () => {
  it('reduces both halves of a Live Photo to the same stem', () => {
    expect(motionPhotoStem('IMG_1234.HEIC')).toBe('img_1234');
    expect(motionPhotoStem('IMG_1234.MOV')).toBe('img_1234');
  });

  it("drops Google's .MP marker so a motion photo matches its clip", () => {
    expect(motionPhotoStem('PXL_20230101.MP.jpg')).toBe('pxl_20230101');
    expect(motionPhotoStem('PXL_20230101.mp4')).toBe('pxl_20230101');
  });

  it("drops Takeout's copy suffix", () => {
    expect(motionPhotoStem('IMG_1234(1).JPG')).toBe('img_1234');
  });

  it('ignores a leading path', () => {
    expect(motionPhotoStem('Google Photos/2019/IMG_1234.MP4')).toBe('img_1234');
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

const appleClipMeta = {
  motionPhoto: {
    subtype: 'live_photo_apple' as const,
    signal: CONTENT_IDENTIFIER_KEY,
    contentIdentifier: IDENTIFIER,
  },
};

describe('pairMotionPhotos', () => {
  it('folds a motion candidate into the still it shares a name with', () => {
    const still = photo('IMG_1234.HEIC', 'image/heic');
    const clip = photo('IMG_1234.MOV', 'video/quicktime');

    const items = pairMotionPhotos([still], [clip]);

    expect(items).toHaveLength(1);
    expect(items[0].photo).toBe(still);
    expect(items[0].motion).toBe(clip);
    expect(items[0].isMotionPhoto).toBe(true);
    expect(items[0].subtype).toBe('live_photo_apple');
  });

  it('drops an ordinary video pulled in only as a candidate', () => {
    const items = pairMotionPhotos(
      [photo('IMG_1234.HEIC', 'image/heic')],
      [photo('holiday.mp4', 'video/mp4')],
    );

    expect(items).toHaveLength(1);
    expect(items[0].motion).toBeNull();
    expect(items[0].isMotionPhoto).toBe(false);
  });

  it('stops a listed clip showing as its own tile once it is paired', () => {
    const still = photo('IMG_9.JPG', 'image/jpeg');
    const clip = photo('IMG_9.MOV', 'video/quicktime');

    const items = pairMotionPhotos([still, clip]);

    expect(items.map((i) => i.photo.id)).toEqual([still.id]);
    expect(items[0].motion).toBe(clip);
  });

  it('keeps an unpaired ordinary video that the listing itself returned', () => {
    const video = photo('holiday.mp4', 'video/mp4');

    const items = pairMotionPhotos([video]);

    expect(items).toHaveLength(1);
    expect(items[0].photo).toBe(video);
    expect(items[0].isMotionPhoto).toBe(false);
  });

  it('prefers the content identifier over the filename', () => {
    const still = photo('renamed-still.heic', 'image/heic', appleClipMeta);
    const decoy = photo('IMG_1234.HEIC', 'image/heic');
    const clip = photo('IMG_1234.MOV', 'video/quicktime', appleClipMeta);

    const items = pairMotionPhotos([decoy, still], [clip]);

    expect(items.find((i) => i.photo.id === still.id)?.motion).toBe(clip);
    expect(items.find((i) => i.photo.id === decoy.id)?.motion).toBeNull();
  });

  it('gives a motion photo clip whose still is missing a tile of its own', () => {
    const clip = photo('IMG_1234.MOV', 'video/quicktime', appleClipMeta);

    const items = pairMotionPhotos([], [clip]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ photo: clip, motion: null, isMotionPhoto: true });
  });

  /** Issue #156: a Google Motion Photo is one file and needs no partner. */
  it('marks a self-contained Google Motion Photo as motion, with no partner file', () => {
    const jpeg = photo('PXL_1.MP.jpg', 'image/jpeg', {
      motionPhoto: {
        subtype: 'motion_photo_google',
        signal: 'GCamera:MotionPhoto',
        embedded: { offset: 1000, length: 500 },
      },
    });

    const items = pairMotionPhotos([jpeg]);

    expect(items).toHaveLength(1);
    expect(items[0].motion).toBeNull();
    expect(items[0].embedded).toEqual({ offset: 1000, length: 500 });
    expect(items[0].subtype).toBe('motion_photo_google');
    expect(items[0].isMotionPhoto).toBe(true);
  });

  it('folds a Google clip exported beside its still into that still', () => {
    const still = photo('PXL_20230101.MP.jpg', 'image/jpeg');
    const clip = photo('PXL_20230101.mp4', 'video/mp4', {
      motionPhoto: { subtype: 'motion_photo_google', signal: 'GCamera:MotionPhoto' },
    });

    const items = pairMotionPhotos([still], [clip]);

    expect(items).toHaveLength(1);
    expect(items[0].motion).toBe(clip);
    expect(items[0].subtype).toBe('motion_photo_google');
  });

  it('never gives one still two clips', () => {
    const still = photo('IMG_1234.JPG', 'image/jpeg');
    const first = photo('IMG_1234.MOV', 'video/quicktime');
    const second = photo('IMG_1234.mp4', 'video/mp4');

    const items = pairMotionPhotos([still], [first, second]);

    expect(items).toHaveLength(1);
    expect(items[0].motion).toBe(first);
  });

  it('preserves the order of the listing it was given', () => {
    const a = photo('a.jpg', 'image/jpeg');
    const b = photo('b.jpg', 'image/jpeg');
    const c = photo('c.jpg', 'image/jpeg');

    expect(pairMotionPhotos([c, a, b]).map((i) => i.photo.id)).toEqual([c.id, a.id, b.id]);
  });
});

describe('motionPhotoLabel', () => {
  it('names each platform the way that platform does', () => {
    expect(motionPhotoLabel('live_photo_apple')).toBe('LIVE');
    expect(motionPhotoLabel('motion_photo_google')).toBe('MOTION');
  });
});
