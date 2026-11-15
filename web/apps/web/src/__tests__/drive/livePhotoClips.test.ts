/**
 * Loading and confirming a Live Photo clip (issue #316), and the preview's
 * lookups beyond the loaded listing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/plainFileBlob', () => ({ loadPlainBlob: vi.fn() }));

import { clipVerdict, loadLiveClip, resetLiveClipCache, cachedClip, type ClipLoaderDeps } from '@/lib/livePhotos/clipLoader';
import { resolvePreviewClip, type ResolvePreviewDeps } from '@/lib/livePhotos/resolvePreviewClip';
import type { FileClip, PairableFile } from '@/lib/livePhotos/pairing';
import type { PhotoResponse } from '@neutrino/api-photos';

const ctx = { userId: 'u1', unlocked: true };

function stemClip(overrides: Partial<FileClip> = {}): FileClip {
  return {
    kind: 'file',
    fileId: 'clip-1',
    mimeType: 'video/quicktime',
    sizeBytes: 3_000_000,
    via: 'stem',
    confirmed: false,
    subtype: 'live_photo_apple',
    ...overrides,
  };
}

function deps(metadata: Record<string, string | number> | null): ClipLoaderDeps & { loadPlainBlob: ReturnType<typeof vi.fn> } {
  return {
    loadPlainBlob: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])])),
    readQuickTimeMetadata: vi.fn(async () => metadata),
  };
}

beforeEach(() => resetLiveClipCache());

describe('loadLiveClip', () => {
  it("plays a name-matched clip whose metadata carries Apple's content identifier", async () => {
    const d = deps({ 'com.apple.quicktime.content.identifier': 'ABC' });
    const blob = await loadLiveClip('still-1', stemClip(), ctx, d);
    expect(blob?.type).toBe('video/quicktime');
    expect(clipVerdict('clip-1')).toBe(true);
  });

  it('refuses an ordinary video that only shares the name, and remembers that for the session', async () => {
    const d = deps({ 'com.apple.quicktime.make': 'Apple' });
    expect(await loadLiveClip('still-1', stemClip(), ctx, d)).toBeNull();
    expect(clipVerdict('clip-1')).toBe(false);
    // Asked again: no second download.
    expect(await loadLiveClip('still-1', stemClip(), ctx, d)).toBeNull();
    expect(d.loadPlainBlob).toHaveBeenCalledTimes(1);
  });

  it('does not parse a clip something already vouches for', async () => {
    const d = deps(null);
    const blob = await loadLiveClip('still-1', stemClip({ via: 'link', confirmed: true }), ctx, d);
    expect(blob).not.toBeNull();
    expect(d.readQuickTimeMetadata).not.toHaveBeenCalled();
  });

  it('shares one download between concurrent callers and keeps the bytes for the next press', async () => {
    const d = deps({ 'com.apple.quicktime.content.identifier': 'ABC' });
    const [a, b] = await Promise.all([
      loadLiveClip('still-1', stemClip(), ctx, d),
      loadLiveClip('still-1', stemClip(), ctx, d),
    ]);
    expect(a).toBe(b);
    expect(d.loadPlainBlob).toHaveBeenCalledTimes(1);
    expect(cachedClip('clip-1')).toBe(a);
  });

  it('does not record a verdict when the download fails, so the next press retries', async () => {
    const d = deps({ 'com.apple.quicktime.content.identifier': 'ABC' });
    d.loadPlainBlob.mockRejectedValueOnce(new Error('network'));
    await expect(loadLiveClip('still-1', stemClip(), ctx, d)).rejects.toThrow('network');
    expect(clipVerdict('clip-1')).toBeUndefined();
    expect(await loadLiveClip('still-1', stemClip(), ctx, d)).not.toBeNull();
  });

  it('loads nothing while the session is locked, rather than judging ciphertext', async () => {
    const d = deps(null);
    await expect(loadLiveClip('still-1', stemClip(), { ...ctx, unlocked: false }, d)).rejects.toThrow(/locked/);
    expect(d.loadPlainBlob).not.toHaveBeenCalled();
    expect(clipVerdict('clip-1')).toBeUndefined();
  });

  it("slices Google's embedded clip out of the still the caller already decrypted", async () => {
    const still = new Blob([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])]);
    const d = deps(null);
    const blob = await loadLiveClip(
      'still-1',
      { kind: 'embedded', offset: 4, length: 3, confirmed: true, subtype: 'motion_photo_google' },
      { ...ctx, stillBlob: still },
      d,
    );
    expect(blob?.type).toBe('video/mp4');
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([4, 5, 6]);
    expect(d.loadPlainBlob).not.toHaveBeenCalled();
  });
});

describe('resolvePreviewClip', () => {
  const still: PairableFile = { id: 's', name: 'IMG_7.HEIC', mimeType: 'image/heic', folderId: 'f', sizeBytes: 1 };
  const stillBlob = new Blob([new Uint8Array([1])]);

  function previewDeps(overrides: Partial<ResolvePreviewDeps> = {}): ResolvePreviewDeps {
    return {
      listPhotosByFiles: vi.fn(async () => [] as PhotoResponse[]),
      getFolderContents: vi.fn(async () => ({ folder: null, folders: [], files: [] })),
      readMotionPhotoInfo: vi.fn(async () => null),
      ...overrides,
    };
  }

  it('uses a loaded sibling without listing the folder', async () => {
    const d = previewDeps();
    const mov: PairableFile = { id: 'm', name: 'IMG_7.MOV', mimeType: 'video/quicktime', folderId: 'f', sizeBytes: 2 };
    const clip = await resolvePreviewClip({ still, stillBlob, siblings: [still, mov], rootFolderId: 'u1' }, d);
    expect(clip).toMatchObject({ fileId: 'm', via: 'stem' });
    expect(d.getFolderContents).not.toHaveBeenCalled();
    expect(d.listPhotosByFiles).toHaveBeenCalledWith(['s', 'm']);
  });

  it("looks the sibling up in the still's folder when the listing has not loaded it", async () => {
    const mov = { id: 'm', name: 'IMG_7.MOV', mimeType: 'video/quicktime', folderId: 'f', sizeBytes: 2 };
    const d = previewDeps({
      getFolderContents: vi.fn(async () => ({ folder: null, folders: [], files: [mov as never] })),
    });
    const clip = await resolvePreviewClip({ still, stillBlob, siblings: [], rootFolderId: 'u1' }, d);
    expect(clip).toMatchObject({ fileId: 'm' });
    expect(d.getFolderContents).toHaveBeenCalledWith('f', expect.objectContaining({ type: 'video' }));
  });

  it('lists the drive root under the user id for a still at the top level', async () => {
    const d = previewDeps();
    await resolvePreviewClip({ still: { ...still, folderId: null }, stillBlob, rootFolderId: 'u1' }, d);
    expect(d.getFolderContents).toHaveBeenCalledWith('u1', expect.anything());
  });

  it("follows the still record's link before anything else", async () => {
    const d = previewDeps({
      listPhotosByFiles: vi.fn(async () => [
        { fileId: 's', metadata: { device: { liveVideoFileID: 'ios-clip' } } } as PhotoResponse,
      ]),
    });
    const clip = await resolvePreviewClip({ still, stillBlob, rootFolderId: 'u1' }, d);
    expect(clip).toMatchObject({ fileId: 'ios-clip', via: 'link' });
    expect(d.getFolderContents).not.toHaveBeenCalled();
  });

  it("falls back to the still's own bytes for a Google Motion Photo", async () => {
    const d = previewDeps({
      readMotionPhotoInfo: vi.fn(async () => ({
        subtype: 'motion_photo_google' as const,
        signal: 'GCamera:MotionPhoto',
        embedded: { offset: 100, length: 50 },
      })),
    });
    const jpeg = { ...still, name: 'PXL_1.MP.jpg', mimeType: 'image/jpeg' };
    const clip = await resolvePreviewClip({ still: jpeg, stillBlob, rootFolderId: 'u1' }, d);
    expect(clip).toMatchObject({ kind: 'embedded', offset: 100, length: 50 });
  });

  it('answers null for a plain picture, and survives Photos being unreachable', async () => {
    const d = previewDeps({ listPhotosByFiles: vi.fn(async () => Promise.reject(new Error('503'))) });
    expect(await resolvePreviewClip({ still, stillBlob, rootFolderId: 'u1' }, d)).toBeNull();
  });
});
