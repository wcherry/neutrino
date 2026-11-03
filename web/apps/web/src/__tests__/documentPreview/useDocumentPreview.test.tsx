/**
 * When an editor's Drive preview is redrawn.
 *
 * The rule the hook exists for: only when page one changed, or when the file
 * has no preview at all — never merely because a save happened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const driveSetThumbnail = vi.fn();
vi.mock('@neutrino/api-drive', () => ({
  driveSetThumbnail: (...a: unknown[]) => driveSetThumbnail(...a),
}));

import { useDocumentPreview } from '@/hooks/useDocumentPreview';

const image = new Blob(['jpeg'], { type: 'image/jpeg' });

function setup(render = vi.fn(async () => image), canEdit = true) {
  const hook = renderHook(() => useDocumentPreview('file-1', { render, canEdit }));
  return { preview: () => hook.result.current, render };
}

/** Lets the idle callback and the upload it starts run to the end. */
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  driveSetThumbnail.mockReset();
  driveSetThumbnail.mockResolvedValue({ coverThumbnailUrl: '/t?v=1' });
});

describe('useDocumentPreview', () => {
  it('draws nothing on load when the file already has a preview', async () => {
    const { preview, render } = setup();
    preview().loaded('page-1', true);
    await settle();
    expect(render).not.toHaveBeenCalled();
    expect(driveSetThumbnail).not.toHaveBeenCalled();
  });

  it('draws one on load for a file that has none', async () => {
    const { preview } = setup();
    preview().loaded('page-1', false);
    await waitFor(() => expect(driveSetThumbnail).toHaveBeenCalledWith('file-1', image));
  });

  it('does not redraw after a save that left page one alone', async () => {
    const { preview, render } = setup();
    preview().loaded('page-1', true);
    preview().saved('page-1', true);
    preview().saved('page-1', true);
    await settle();
    expect(render).not.toHaveBeenCalled();
  });

  it('redraws once page one changes, and not again for the same page', async () => {
    const { preview, render } = setup();
    preview().loaded('page-1', true);
    preview().saved('page-1 edited', true);
    await waitFor(() => expect(driveSetThumbnail).toHaveBeenCalledTimes(1));
    preview().saved('page-1 edited', true);
    await settle();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('redraws after a save of a file that has no preview yet', async () => {
    const { preview } = setup();
    preview().saved('blank', false);
    await waitFor(() => expect(driveSetThumbnail).toHaveBeenCalledTimes(1));
  });

  it('retries on the next save when an upload fails', async () => {
    driveSetThumbnail.mockRejectedValueOnce(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { preview } = setup();
    preview().loaded('page-1', true);
    preview().saved('page-1 edited', true);
    await waitFor(() => expect(driveSetThumbnail).toHaveBeenCalledTimes(1));
    await settle();
    preview().saved('page-1 edited', true);
    await waitFor(() => expect(driveSetThumbnail).toHaveBeenCalledTimes(2));
    warn.mockRestore();
  });

  it('runs one render at a time and catches up with the newest page after it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const render = vi.fn(async () => { await gate; return image; });
    const { preview } = setup(render);
    preview().loaded('v0', true);
    preview().saved('v1', true);
    await waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    preview().saved('v2', true);
    preview().saved('v3', true);
    expect(render).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    await settle();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('does not upload for someone who cannot edit', async () => {
    const { preview, render } = setup(undefined, false);
    preview().loaded('page-1', false);
    await settle();
    expect(render).not.toHaveBeenCalled();
    expect(driveSetThumbnail).not.toHaveBeenCalled();
  });

  it('stores nothing when the editor has nothing to draw', async () => {
    const { preview, render } = setup(vi.fn(async () => null));
    preview().loaded('page-1', false);
    await waitFor(() => expect(render).toHaveBeenCalled());
    await settle();
    expect(driveSetThumbnail).not.toHaveBeenCalled();
  });
});
