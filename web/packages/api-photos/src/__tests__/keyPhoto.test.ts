/**
 * Changing and reverting a Live Photo's key photo against a fake Drive (issue
 * #317): the two-file order, rollback on every later failure, the 409, and
 * revert putting back bytes, name, type, thumbnail and `stillImageTime`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyKeyPhoto,
  revertKeyPhoto,
  keyPhotoFileName,
  KeyPhotoConflictError,
  ORIGINAL_KEY_PHOTO_LABEL,
  KEY_PHOTO_LABEL,
  type KeyPhotoDeps,
  type KeyPhotoFile,
} from '../keyPhoto';
import { readStillImageTimeTrack } from '../quicktime';
import type { PhotoResponse } from '../index';
import { emptyEditLayout, metaTrack, movie } from './fixtures/liveClip';

interface FakeFile {
  name: string;
  mimeType: string;
  content: Uint8Array;
  contentVersion: number;
  thumb: string | null;
  versions: Array<{ id: string; label: string; bytes: Uint8Array }>;
}

class FakeDrive {
  files = new Map<string, FakeFile>();
  records = new Map<string, Record<string, unknown>>();
  log: string[] = [];
  /** Make the next write to this file fail with this status. */
  failReplaceOf: { fileId: string; status?: number } | null = null;
  failMerge = false;
  private seq = 0;

  add(id: string, file: Omit<FakeFile, 'contentVersion' | 'versions'>) {
    this.files.set(id, { ...file, contentVersion: 1, versions: [] });
  }

  deps(): KeyPhotoDeps {
    return {
      fileKey: async (id) => new Uint8Array([id.length]),
      fileState: async (id) => {
        const f = this.files.get(id)!;
        return { contentVersion: f.contentVersion, coverThumbnailUrl: f.thumb ? `/thumb/${id}` : null };
      },
      saveVersion: async (id, plain, _dek, label) => {
        const f = this.files.get(id)!;
        const v = { id: `v${++this.seq}`, label, bytes: plain.slice() };
        f.versions.push(v);
        f.content = plain.slice();
        f.contentVersion += 1;
        this.log.push(`snapshot ${id} "${label}"`);
        return { id: v.id };
      },
      replace: async (id, plain, _dek, extras, expected) => {
        const f = this.files.get(id)!;
        if (this.failReplaceOf?.fileId === id) {
          const status = this.failReplaceOf.status ?? 500;
          this.failReplaceOf = null;
          throw Object.assign(new Error('nope'), { statusCode: status });
        }
        if (expected !== f.contentVersion) throw Object.assign(new Error('stale'), { statusCode: 409, code: 'CONTENT_VERSION_CONFLICT' });
        f.content = plain.slice();
        f.contentVersion += 1;
        if (extras.name) f.name = extras.name;
        if (extras.mimeType) f.mimeType = extras.mimeType;
        if (extras.thumbnailB64) f.thumb = extras.thumbnailB64;
        this.log.push(`write ${id}`);
        return { contentVersion: f.contentVersion };
      },
      versionBytes: async (id, versionId) => this.files.get(id)!.versions.find((v) => v.id === versionId)!.bytes,
      currentThumbnail: async (url) => (url ? this.files.get(url.split('/').pop()!)!.thumb : null),
      mergePhotoMetadata: async (photoId, patch) => {
        if (this.failMerge) {
          this.failMerge = false;
          throw new Error('photos service down');
        }
        this.records.set(photoId, mergePatch(this.records.get(photoId) ?? {}, patch));
        this.log.push(`record ${photoId}`);
        return this.records.get(photoId);
      },
      imageThumbnail: async (_plain, mime) => `thumb-of-${mime}`,
      clipThumbnail: async (_plain, at) => `clip-thumb-at-${at}`,
      resetDerivedData: async (photoId) => {
        this.log.push(`reset ${photoId}`);
      },
    };
  }
}

function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array)) {
      out[k] = mergePatch((out[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
    } else out[k] = v;
  }
  return out;
}

const STILL_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]); // a HEIC's opening
const FRAME_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const CLIP = movie(emptyEditLayout()).bytes; // key frame at 1.5 s

let drive: FakeDrive;

function photoRecord(): PhotoResponse {
  return {
    id: 'photo-1',
    fileId: 'still',
    fileName: 'IMG_1234.HEIC',
    mimeType: 'image/heic',
    sizeBytes: 8,
    contentUrl: '',
    thumbnailUrl: null,
    isStarred: true,
    isArchived: false,
    captureDate: null,
    createdAt: '',
    updatedAt: '',
    deletedAt: null,
    metadata: (drive.records.get('photo-1') ?? null) as PhotoResponse['metadata'],
  };
}

function file(id: 'still' | 'clip'): KeyPhotoFile {
  const f = drive.files.get(id)!;
  return { fileId: id, name: f.name, mimeType: f.mimeType, contentVersion: f.contentVersion, plain: f.content };
}

function frame(seconds = 0.75) {
  return { jpeg: FRAME_JPEG, width: 1440, height: 1080, seconds, thumbnailB64: 'frame-thumb' };
}

beforeEach(() => {
  drive = new FakeDrive();
  drive.add('still', { name: 'IMG_1234.HEIC', mimeType: 'image/heic', content: STILL_BYTES, thumb: 'original-still-thumb' });
  drive.add('clip', { name: 'IMG_1234.MOV', mimeType: 'video/quicktime', content: CLIP, thumb: 'original-clip-thumb' });
  drive.records.set('photo-1', { width: 4032, height: 3024, motionPhoto: { subtype: 'live_photo_apple', stillImageTime: 1.5 } });
});

describe('keyPhotoFileName', () => {
  it('keeps the stem so stem pairing still holds, and the case of the extension', () => {
    expect(keyPhotoFileName('IMG_1234.HEIC')).toBe('IMG_1234.JPG');
    expect(keyPhotoFileName('img_1234.heic')).toBe('img_1234.jpg');
    expect(keyPhotoFileName('IMG_1234.JPG')).toBe('IMG_1234.JPG');
  });
});

describe('applyKeyPhoto', () => {
  it('snapshots both files, then writes the clip, the still and the record in that order', async () => {
    const result = await applyKeyPhoto(
      { photo: photoRecord(), still: file('still'), clip: file('clip'), frame: frame(), originalStillImageTime: 1.5 },
      drive.deps(),
    );

    expect(result.clipRewritten).toBe(true);
    expect(drive.log).toEqual([
      `snapshot still "${ORIGINAL_KEY_PHOTO_LABEL}"`,
      `snapshot clip "${ORIGINAL_KEY_PHOTO_LABEL}"`,
      'write clip',
      'write still',
      'record photo-1',
      'reset photo-1',
    ]);
  });

  it('leaves one file, same id, now a JPEG named for its stem, with the new thumbnail', async () => {
    await applyKeyPhoto({ photo: photoRecord(), still: file('still'), clip: file('clip'), frame: frame(), originalStillImageTime: 1.5 }, drive.deps());
    const still = drive.files.get('still')!;
    expect(still.name).toBe('IMG_1234.JPG');
    expect(still.mimeType).toBe('image/jpeg');
    expect(still.content).toEqual(FRAME_JPEG);
    expect(still.thumb).toBe('frame-thumb');
    expect(still.versions[0].bytes).toEqual(STILL_BYTES);
  });

  it("moves the clip's key frame to the chosen time, under the same name and type", async () => {
    await applyKeyPhoto({ photo: photoRecord(), still: file('still'), clip: file('clip'), frame: frame(0.75), originalStillImageTime: 1.5 }, drive.deps());
    const clip = drive.files.get('clip')!;
    expect(readStillImageTimeTrack(clip.content)).toBeCloseTo(0.75);
    expect(clip.name).toBe('IMG_1234.MOV');
    expect(clip.mimeType).toBe('video/quicktime');
    expect(clip.versions[0].bytes).toEqual(CLIP);
  });

  it('records where the originals are, merging rather than replacing the metadata', async () => {
    await applyKeyPhoto({ photo: photoRecord(), still: file('still'), clip: file('clip'), frame: frame(0.75), originalStillImageTime: 1.5 }, drive.deps());
    const record = drive.records.get('photo-1') as Record<string, any>;
    expect(record.motionPhoto).toEqual({ subtype: 'live_photo_apple', stillImageTime: 0.75 });
    expect(record.width).toBe(1440);
    expect(record.keyPhoto).toMatchObject({
      originalVersionId: drive.files.get('still')!.versions[0].id,
      originalName: 'IMG_1234.HEIC',
      originalMimeType: 'image/heic',
      clipOriginalVersionId: drive.files.get('clip')!.versions[0].id,
      originalStillImageTime: 1.5,
      clipRewritten: true,
      frameSeconds: 0.75,
      originalWidth: 4032,
      originalHeight: 3024,
    });
  });

  it('replaces the still and leaves an unrecognised clip alone, saying so', async () => {
    const odd = movie(metaTrack({ stts: [[2, 1000]], mediaTimescale: 1000, duration: 2000 })).bytes;
    drive.files.get('clip')!.content = odd;
    const result = await applyKeyPhoto({ photo: photoRecord(), still: file('still'), clip: file('clip'), frame: frame(), originalStillImageTime: 1 }, drive.deps());

    expect(result.clipRewritten).toBe(false);
    expect(drive.files.get('clip')!.content).toEqual(odd);
    expect(drive.files.get('clip')!.versions).toEqual([]);
    expect(drive.files.get('still')!.mimeType).toBe('image/jpeg');
    expect((drive.records.get('photo-1') as any).keyPhoto.clipRewritten).toBe(false);
  });

  it('refuses to start when either file moved on since it was loaded', async () => {
    const stale = file('clip');
    drive.files.get('clip')!.contentVersion += 1;
    await expect(
      applyKeyPhoto({ photo: photoRecord(), still: file('still'), clip: stale, frame: frame(), originalStillImageTime: 1.5 }, drive.deps()),
    ).rejects.toBeInstanceOf(KeyPhotoConflictError);
    expect(drive.log).toEqual([]);
  });

  it('puts the clip back when the still cannot be written (409), and reports the conflict', async () => {
    const deps = drive.deps();
    const realReplace = deps.replace;
    deps.replace = async (id, ...rest) => {
      if (id === 'still') {
        drive.files.get('still')!.contentVersion += 1; // someone else saved meanwhile
      }
      return realReplace(id, ...rest);
    };

    await expect(
      applyKeyPhoto({ photo: photoRecord(), still: file('still'), clip: file('clip'), frame: frame(), originalStillImageTime: 1.5 }, deps),
    ).rejects.toBeInstanceOf(KeyPhotoConflictError);

    const clip = drive.files.get('clip')!;
    expect(clip.content).toEqual(CLIP);
    expect(clip.thumb).toBe('original-clip-thumb');
    expect(drive.files.get('still')!.content).toEqual(STILL_BYTES);
    expect(drive.files.get('still')!.name).toBe('IMG_1234.HEIC');
    expect((drive.records.get('photo-1') as any).keyPhoto).toBeUndefined();
  });

  it('puts both files back when the record cannot be updated', async () => {
    drive.failMerge = true;
    await expect(
      applyKeyPhoto({ photo: photoRecord(), still: file('still'), clip: file('clip'), frame: frame(), originalStillImageTime: 1.5 }, drive.deps()),
    ).rejects.toThrow('photos service down');

    const still = drive.files.get('still')!;
    expect(still.content).toEqual(STILL_BYTES);
    expect(still.name).toBe('IMG_1234.HEIC');
    expect(still.mimeType).toBe('image/heic');
    expect(still.thumb).toBe('original-still-thumb');
    expect(drive.files.get('clip')!.content).toEqual(CLIP);
  });

  it('a second change keeps the original pointers and labels its snapshots "Key photo"', async () => {
    await applyKeyPhoto({ photo: photoRecord(), still: file('still'), clip: file('clip'), frame: frame(0.75), originalStillImageTime: 1.5 }, drive.deps());
    const first = (drive.records.get('photo-1') as any).keyPhoto;
    drive.log = [];

    await applyKeyPhoto({ photo: photoRecord(), still: file('still'), clip: file('clip'), frame: frame(2), originalStillImageTime: 0.75 }, drive.deps());

    expect(drive.log.slice(0, 2)).toEqual([`snapshot still "${KEY_PHOTO_LABEL}"`, `snapshot clip "${KEY_PHOTO_LABEL}"`]);
    const second = (drive.records.get('photo-1') as any).keyPhoto;
    expect(second.originalVersionId).toBe(first.originalVersionId);
    expect(second.clipOriginalVersionId).toBe(first.clipOriginalVersionId);
    expect(second.originalName).toBe('IMG_1234.HEIC');
    expect(second.originalStillImageTime).toBe(1.5);
    expect(second.frameSeconds).toBe(2);
  });
});

describe('revertKeyPhoto', () => {
  beforeEach(async () => {
    await applyKeyPhoto({ photo: photoRecord(), still: file('still'), clip: file('clip'), frame: frame(0.75), originalStillImageTime: 1.5 }, drive.deps());
    drive.log = [];
  });

  it("brings back both files' bytes, the still's name, type and thumbnail, and the key-frame time", async () => {
    await revertKeyPhoto({ photo: photoRecord(), still: file('still'), clip: file('clip') }, drive.deps());

    const still = drive.files.get('still')!;
    expect(still.content).toEqual(STILL_BYTES);
    expect(still.name).toBe('IMG_1234.HEIC');
    expect(still.mimeType).toBe('image/heic');
    expect(still.thumb).toBe('thumb-of-image/heic');
    const clip = drive.files.get('clip')!;
    expect(clip.content).toEqual(CLIP);
    expect(clip.thumb).toBe('clip-thumb-at-1.5');
    const record = drive.records.get('photo-1') as Record<string, any>;
    expect(record.keyPhoto).toBeUndefined();
    expect(record.motionPhoto.stillImageTime).toBe(1.5);
    expect(record.width).toBe(4032);
    expect(drive.log.slice(0, 3)).toEqual(['write clip', 'write still', 'record photo-1']);
  });

  it('keeps the originals in history after reverting', async () => {
    await revertKeyPhoto({ photo: photoRecord(), still: file('still'), clip: file('clip') }, drive.deps());
    expect(drive.files.get('still')!.versions.map((v) => v.label)).toEqual([ORIGINAL_KEY_PHOTO_LABEL]);
  });

  it('puts the clip back when the still cannot be reverted', async () => {
    const before = drive.files.get('clip')!.content.slice();
    drive.failReplaceOf = { fileId: 'still', status: 500 };
    await expect(revertKeyPhoto({ photo: photoRecord(), still: file('still'), clip: file('clip') }, drive.deps())).rejects.toThrow();
    expect(drive.files.get('clip')!.content).toEqual(before);
    expect(drive.files.get('still')!.mimeType).toBe('image/jpeg');
  });

  it('refuses a photo whose key photo was never changed', async () => {
    drive.records.set('photo-1', {});
    await expect(revertKeyPhoto({ photo: photoRecord(), still: file('still'), clip: file('clip') }, drive.deps())).rejects.toThrow(/not been changed/);
  });
});
