/**
 * Writing Live Photo links (agent_docs/live-photos.md): at the end of an import run, and lazily
 * as the library is browsed. Both must write only `device.liveVideoFileID`, through a merge, and
 * neither may fail the thing it rides on.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { pairMotionPhotos, type PhotoResponse } from '@neutrino/api-photos';
import { linkMotionPairs, writeMotionLinks } from '@/lib/motionLinks';
import { MAX_PER_PASS, useMotionLinkBackfill } from '@/app/(apps)/photos/useMotionLinkBackfill';

let next = 0;
function photo(fileName: string, mimeType: string, metadata: PhotoResponse['metadata'] = null): PhotoResponse {
  const id = `p${++next}`;
  return {
    id, fileId: `f-${id}`, fileName, mimeType, sizeBytes: 1, contentUrl: '', thumbnailUrl: null,
    isStarred: false, isArchived: false, captureDate: null, createdAt: '', updatedAt: '',
    deletedAt: null, metadata,
  };
}

describe('linkMotionPairs', () => {
  it('links each imported still to its clip with a merge of device.liveVideoFileID only', async () => {
    const still = photo('IMG_1.HEIC', 'image/heic');
    const clip = photo('IMG_1.MOV', 'video/quicktime');
    const plain = photo('IMG_2.JPG', 'image/jpeg');
    const merge = vi.fn(async () => ({}));

    const written = await linkMotionPairs([still, plain, clip], merge);

    expect(written).toBe(1);
    expect(merge).toHaveBeenCalledWith(still.id, { device: { liveVideoFileID: clip.fileId } });
  });

  it('writes nothing for a run with no clips, or a still that already names its clip', async () => {
    const merge = vi.fn(async () => ({}));
    await linkMotionPairs([photo('a.HEIC', 'image/heic')], merge);
    const clip = photo('IMG_3.MOV', 'video/quicktime');
    await linkMotionPairs([photo('IMG_3.HEIC', 'image/heic', { device: { liveVideoFileID: clip.fileId } }), clip], merge);
    expect(merge).not.toHaveBeenCalled();
  });

  it('never throws: a failed write is logged and the rest carry on', async () => {
    const a = photo('IMG_4.HEIC', 'image/heic');
    const b = photo('IMG_5.HEIC', 'image/heic');
    const merge = vi.fn()
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce({});
    const written = await linkMotionPairs([a, b, photo('IMG_4.MOV', 'video/quicktime'), photo('IMG_5.MOV', 'video/quicktime')], merge);
    expect(merge).toHaveBeenCalledTimes(2);
    expect(written).toBe(1);
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const merge = vi.fn(async () => ({}));
    expect(await writeMotionLinks([{ photoId: 'x', liveVideoFileID: 'y' }], merge, controller.signal)).toBe(0);
    expect(merge).not.toHaveBeenCalled();
  });
});

describe('useMotionLinkBackfill', () => {
  it('writes the missing links once, however often the page re-renders', async () => {
    const still = photo('IMG_10.HEIC', 'image/heic');
    const clip = photo('IMG_10.MOV', 'video/quicktime');
    const items = pairMotionPhotos([still], [clip]);
    const merge = vi.fn(async () => ({}));

    const { rerender } = renderHook(({ list }) => useMotionLinkBackfill(list, merge), { initialProps: { list: items } });
    await vi.waitFor(() => expect(merge).toHaveBeenCalledTimes(1));
    rerender({ list: [...items] });
    await new Promise((r) => setTimeout(r, 0));

    expect(merge).toHaveBeenCalledTimes(1);
    expect(merge).toHaveBeenCalledWith(still.id, { device: { liveVideoFileID: clip.fileId } });
  });

  it('writes at most a pass-worth at a time', async () => {
    const stills = Array.from({ length: MAX_PER_PASS + 5 }, (_, i) => photo(`IMG_${100 + i}.HEIC`, 'image/heic'));
    const clips = stills.map((s) => photo(s.fileName.replace('.HEIC', '.MOV'), 'video/quicktime'));
    const merge = vi.fn(async () => ({}));
    renderHook(() => useMotionLinkBackfill(pairMotionPhotos(stills, clips), merge));
    await vi.waitFor(() => expect(merge).toHaveBeenCalledTimes(MAX_PER_PASS));
  });
});
