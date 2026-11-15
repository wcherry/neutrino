/**
 * Finding a Live Photo's clip in Drive (issue #316).
 *
 * The precedence is the feature: the still's own link beats a name, a name
 * beats nothing, and Google's embedded clip is what is left. And a name alone
 * is never enough to call a video a Live Photo's — `confirmed` is what decides
 * whether the bytes have to be checked first.
 */

import { describe, it, expect } from 'vitest';
import type { PhotoResponse } from '@neutrino/api-photos';
import {
  clipKey,
  clipMimeType,
  embeddedClipFrom,
  findLiveClip,
  isClipCandidate,
  isStillCandidate,
  pairListing,
  stemSibling,
  type PairableFile,
} from '@/lib/livePhotos/pairing';

function file(id: string, name: string, mimeType: string, folderId: string | null = 'folder-1', sizeBytes = 3_000_000): PairableFile {
  return { id, name, mimeType, folderId, sizeBytes };
}

function record(fileId: string, metadata: PhotoResponse['metadata'], extra: Partial<PhotoResponse> = {}): PhotoResponse {
  return {
    id: `photo-${fileId}`,
    fileId,
    fileName: extra.fileName ?? fileId,
    mimeType: extra.mimeType ?? 'image/heic',
    sizeBytes: 1,
    contentUrl: '',
    thumbnailUrl: null,
    isStarred: false,
    isArchived: false,
    captureDate: null,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    metadata,
    ...extra,
  };
}

const appleClipInfo = {
  motionPhoto: { subtype: 'live_photo_apple' as const, signal: 'com.apple.quicktime.content.identifier', contentIdentifier: 'ABC' },
};

describe('candidates', () => {
  it('takes images, and a HEIC the server only knows as octet-stream, as stills', () => {
    expect(isStillCandidate({ name: 'IMG_1.HEIC', mimeType: 'image/heic' })).toBe(true);
    expect(isStillCandidate({ name: 'IMG_1.HEIC', mimeType: 'application/octet-stream' })).toBe(true);
    expect(isStillCandidate({ name: 'notes.txt', mimeType: 'text/plain' })).toBe(false);
  });

  it('takes videos, and a .MOV typed octet-stream, as clips', () => {
    expect(isClipCandidate({ name: 'IMG_1.MOV', mimeType: 'video/quicktime' })).toBe(true);
    expect(isClipCandidate({ name: 'IMG_1.MOV', mimeType: 'application/octet-stream' })).toBe(true);
    expect(isClipCandidate({ name: 'IMG_1.HEIC', mimeType: 'image/heic' })).toBe(false);
  });

  it('types a clip for <video> even when the server could not', () => {
    expect(clipMimeType({ name: 'IMG_1.MOV', mimeType: 'application/octet-stream' })).toBe('video/quicktime');
    expect(clipMimeType({ name: 'PXL_1.mp4', mimeType: 'application/octet-stream' })).toBe('video/mp4');
    expect(clipMimeType({ name: 'IMG_1.MOV', mimeType: 'video/quicktime' })).toBe('video/quicktime');
  });
});

describe('stem matching', () => {
  const still = file('s', 'IMG_1234.HEIC', 'image/heic');

  it('pairs a still with the same-named video beside it', () => {
    const mov = file('m', 'IMG_1234.MOV', 'video/quicktime');
    expect(stemSibling(still, [still, mov])).toBe(mov);
  });

  it('ignores case', () => {
    const mov = file('m', 'img_1234.mov', 'video/quicktime');
    expect(stemSibling(still, [mov])).toBe(mov);
  });

  it('ignores a same-named video in another folder', () => {
    const mov = file('m', 'IMG_1234.MOV', 'video/quicktime', 'folder-2');
    expect(stemSibling(still, [mov])).toBeNull();
  });

  it('does not pair a picture with another picture', () => {
    expect(stemSibling(still, [file('j', 'IMG_1234.JPG', 'image/jpeg')])).toBeNull();
  });

  it('does not pair different stems', () => {
    expect(stemSibling(still, [file('m', 'IMG_1235.MOV', 'video/quicktime')])).toBeNull();
  });

  it('leaves a name-only match unconfirmed, so its bytes are checked before it is called live', () => {
    const mov = file('m', 'IMG_1234.MOV', 'video/quicktime');
    const clip = findLiveClip(still, { siblings: [still, mov] });
    expect(clip).toMatchObject({ kind: 'file', fileId: 'm', via: 'stem', confirmed: false });
  });

  it("confirms a name match when the clip's own record says it is a Live Photo's motion", () => {
    const mov = file('m', 'IMG_1234.MOV', 'video/quicktime');
    const records = new Map([['m', record('m', appleClipInfo, { mimeType: 'video/quicktime' })]]);
    expect(findLiveClip(still, { siblings: [mov], recordsByFile: records })).toMatchObject({
      via: 'stem',
      confirmed: true,
      subtype: 'live_photo_apple',
    });
  });

  it('keeps a name match unconfirmed when the clip has a record but no motion metadata (an ordinary video)', () => {
    const mov = file('m', 'IMG_1234.MOV', 'video/quicktime');
    const records = new Map([['m', record('m', { width: 1920 }, { mimeType: 'video/quicktime' })]]);
    expect(findLiveClip(still, { siblings: [mov], recordsByFile: records })).toMatchObject({ confirmed: false });
  });
});

describe('liveVideoFileID', () => {
  const still = file('s', 'IMG_1234.HEIC', 'image/heic');

  it("takes precedence over a same-named sibling", () => {
    const sibling = file('m', 'IMG_1234.MOV', 'video/quicktime');
    const stillRecord = record('s', { device: { liveVideoFileID: 'linked-clip' } });
    const clip = findLiveClip(still, { siblings: [still, sibling], stillRecord });
    expect(clip).toMatchObject({ kind: 'file', fileId: 'linked-clip', via: 'link', confirmed: true });
  });

  it('finds a clip stored the Photos iOS way, under another name in another folder', () => {
    const stillRecord = record('s', { device: { liveVideoFileID: 'clip-elsewhere' } });
    const clip = findLiveClip(still, { siblings: [], stillRecord });
    expect(clip).toMatchObject({ fileId: 'clip-elsewhere', mimeType: 'video/quicktime', confirmed: true });
  });

  it("takes the linked clip's type and size from the listing when it is loaded", () => {
    const linked = file('l', 's.live.mp4', 'video/mp4', 'other', 2_500_000);
    const stillRecord = record('s', { device: { liveVideoFileID: 'l' } });
    expect(findLiveClip(still, { siblings: [linked], stillRecord })).toMatchObject({
      mimeType: 'video/mp4',
      sizeBytes: 2_500_000,
    });
  });

  it('wins over an embedded clip too', () => {
    const stillRecord = record('s', {
      device: { liveVideoFileID: 'l' },
      motionPhoto: { subtype: 'motion_photo_google', signal: 'GCamera:MotionPhoto', embedded: { offset: 10, length: 20 } },
    });
    expect(findLiveClip(still, { stillRecord })).toMatchObject({ kind: 'file', fileId: 'l' });
  });
});

describe('Google Motion Photos', () => {
  const still = file('g', 'PXL_20230101.MP.jpg', 'image/jpeg');

  it('uses the embedded clip the still record located', () => {
    const stillRecord = record('g', {
      motionPhoto: { subtype: 'motion_photo_google', signal: 'GCamera:MotionPhoto', embedded: { offset: 4000, length: 900 } },
    });
    expect(findLiveClip(still, { stillRecord })).toEqual({
      kind: 'embedded',
      offset: 4000,
      length: 900,
      confirmed: true,
      subtype: 'motion_photo_google',
    });
  });

  it('prefers a separate same-named clip over the embedded one (Takeout exports both)', () => {
    const mp4 = file('v', 'PXL_20230101.mp4', 'video/mp4');
    const stillRecord = record('g', {
      motionPhoto: { subtype: 'motion_photo_google', signal: 'GCamera:MotionPhoto', embedded: { offset: 4000, length: 900 } },
    });
    expect(findLiveClip(still, { siblings: [mp4], stillRecord })).toMatchObject({ kind: 'file', fileId: 'v' });
  });

  it('reads an embedded clip from motion info the preview parsed itself', () => {
    expect(embeddedClipFrom({ subtype: 'motion_photo_google', signal: 'x', embedded: { offset: 5, length: 7 } })).toMatchObject({
      kind: 'embedded',
      offset: 5,
      length: 7,
    });
    expect(embeddedClipFrom({ subtype: 'motion_photo_google', signal: 'x' })).toBeNull();
    expect(embeddedClipFrom(null)).toBeNull();
  });

  it("keys a file clip by its content version, so a clip rewritten by a key-photo change is fetched again", () => {
    const still = file('s', 'IMG_1.HEIC', 'image/heic');
    const v3 = findLiveClip(still, { siblings: [{ ...file('m', 'IMG_1.MOV', 'video/quicktime'), contentVersion: 3 }] })!;
    const v4 = findLiveClip(still, { siblings: [{ ...file('m', 'IMG_1.MOV', 'video/quicktime'), contentVersion: 4 }] })!;
    expect(clipKey('s', v3)).toBe('m@3');
    expect(clipKey('s', v4)).not.toBe(clipKey('s', v3));
  });

  it('keys an embedded clip by its still, since it has no file of its own', () => {
    const clip = embeddedClipFrom({ subtype: 'motion_photo_google', signal: 'x', embedded: { offset: 5, length: 7 } })!;
    expect(clipKey('g', clip)).toBe('embedded:g');
  });
});

describe('pairListing', () => {
  it('pairs every still in a listing and leaves plain pictures out', () => {
    const files = [
      file('a', 'IMG_1.HEIC', 'image/heic'),
      file('b', 'IMG_1.MOV', 'video/quicktime'),
      file('c', 'IMG_2.JPG', 'image/jpeg'),
      file('d', 'holiday.mp4', 'video/mp4'),
    ];
    const pairs = pairListing(files);
    expect([...pairs.keys()]).toEqual(['a']);
    expect(pairs.get('a')).toMatchObject({ fileId: 'b' });
  });

  it('does not offer a clip another still links to as somebody else’s stem match', () => {
    // IMG_9.MOV is linked from s1 (a renamed still); IMG_9.HEIC must not claim it by name.
    const files = [
      file('s1', 'renamed.HEIC', 'image/heic'),
      file('s2', 'IMG_9.HEIC', 'image/heic'),
      file('clip', 'IMG_9.MOV', 'video/quicktime'),
    ];
    const pairs = pairListing(files, [record('s1', { device: { liveVideoFileID: 'clip' } })]);
    expect(pairs.get('s1')).toMatchObject({ fileId: 'clip', via: 'link' });
    expect(pairs.has('s2')).toBe(false);
  });
});
