/**
 * The key-photo scrubber (issue #317). jsdom cannot decode video, so the frame
 * helpers are faked at their module boundary and the dialog's own behaviour —
 * the Original marker, Reset, stepping, the disabled button, the resolution
 * warning, the two modes and Revert — is what is under test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

vi.mock('@neutrino/auth', () => ({ useUser: () => ({ id: 'user-1' }) }));
const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
vi.mock('@neutrino/ui', () => ({
  Modal: ({ open, children, title }: { open: boolean; children: React.ReactNode; title: string }) =>
    open ? <div role="dialog" aria-label={title}>{children}</div> : null,
  Button: ({ children, onClick, disabled, icon, loading: _l, variant: _v, size: _s, ...rest }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} disabled={disabled as boolean} {...(rest as object)}>
      {icon as React.ReactNode}
      {children as React.ReactNode}
    </button>
  ),
  Spinner: () => <div data-testid="spinner" />,
  useToast: () => toast,
}));
vi.mock('@/lib/heic', () => ({ toRenderableImageBlob: async (b: Blob) => b }));
vi.mock('../../app/(apps)/photos/KeyPhotoDialog.module.css', () => ({ default: new Proxy({}, { get: (_t, k) => String(k) }) }));

let seekResult: (t: number) => number = (t) => t;
const seekTo = vi.fn(async (_v: HTMLVideoElement, t: number) => seekResult(t));
const captureFrame = vi.fn(async () => ({ jpeg: new Uint8Array([0xff, 0xd8]), width: 1440, height: 1080 }));
vi.mock('@/lib/livePhotos/keyFrame', () => ({
  FALLBACK_FRAME_SECONDS: 1 / 30,
  seekTo: (v: HTMLVideoElement, t: number) => seekTo(v, t),
  measureFrameDuration: async () => 0.1,
  filmstrip: async () => [],
  captureFrame: () => captureFrame(),
  megapixels: (w: number, h: number) => `${((w * h) / 1e6).toFixed(1)} MP`,
}));

const changeKeyPhoto = vi.fn();
const revertToOriginalKeyPhoto = vi.fn();
const loadKeyPhotoFiles = vi.fn();
vi.mock('@/app/(apps)/photos/keyPhotoSession', () => ({
  CLIP_NOT_UPDATED_WARNING: 'The motion clip couldn’t be updated',
  changeKeyPhoto: (...a: unknown[]) => changeKeyPhoto(...a),
  revertToOriginalKeyPhoto: (...a: unknown[]) => revertToOriginalKeyPhoto(...a),
  loadKeyPhotoFiles: (...a: unknown[]) => loadKeyPhotoFiles(...a),
}));

import { KeyPhotoDialog } from '../../app/(apps)/photos/KeyPhotoDialog';
import { KeyPhotoConflictError } from '@neutrino/api-photos/key-photo';
import type { KeyPhotoTarget } from '../../app/(apps)/photos/useKeyPhotoTarget';

const files = {
  still: { fileId: 'still', name: 'IMG_1.HEIC', mimeType: 'image/heic', contentVersion: 1, plain: new Uint8Array([1]) },
  clip: { fileId: 'clip', name: 'IMG_1.MOV', mimeType: 'video/quicktime', contentVersion: 1, plain: new Uint8Array([2]) },
  currentStillImageTime: 1.5,
};

function target(overrides: Partial<KeyPhotoTarget> = {}): KeyPhotoTarget {
  return {
    stillFileId: 'still',
    photo: { metadata: { width: 4032, height: 3024 } } as KeyPhotoTarget['photo'],
    clipFileId: 'clip',
    clipPhotoId: null,
    keyPhoto: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  seekResult = (t) => t;
  loadKeyPhotoFiles.mockResolvedValue(files);
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:clip');
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
});

/** Render, then make the (fake) video report itself decoded. */
async function open(props: Partial<React.ComponentProps<typeof KeyPhotoDialog>> = {}) {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const onPicked = vi.fn();
  render(
    <KeyPhotoDialog open mode="apply" target={target()} onClose={onClose} onChanged={onChanged} onPicked={onPicked} {...props} />,
  );
  const video = (await screen.findByLabelText('Live Photo clip')) as HTMLVideoElement;
  Object.defineProperty(video, 'duration', { configurable: true, value: 3 });
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1440 });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1080 });
  await act(async () => {
    fireEvent.loadedData(video);
  });
  await screen.findByText('1.50 s');
  return { onClose, onChanged, onPicked };
}

const makeButton = () => screen.getByRole('button', { name: 'Make Key Photo' });

describe('KeyPhotoDialog', () => {
  it('opens on the clip’s current key frame, marked Original, where Make Key Photo is disabled', async () => {
    await open();
    expect(screen.getByText('Original')).toBeInTheDocument();
    expect(makeButton()).toBeDisabled();
    expect(screen.queryByText(/This frame is/)).toBeNull();
  });

  it('steps a frame at a time with the buttons and the arrow keys', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Next frame' }));
    await screen.findByText('1.60 s');
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowLeft' });
    await screen.findByText('1.50 s');
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowLeft' });
    await screen.findByText('1.40 s');
  });

  it('warns about resolution away from the original, and Reset snaps back to it', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Next frame' }));
    await screen.findByText('1.60 s');
    expect(makeButton()).toBeEnabled();
    expect(screen.getByText('This frame is 1.6 MP. The current key photo is 12.2 MP.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
    await screen.findByText('1.50 s');
    expect(makeButton()).toBeDisabled();
  });

  it('shows no Original marker and leaves the button enabled when the clip has no readable key frame', async () => {
    loadKeyPhotoFiles.mockResolvedValue({ ...files, currentStillImageTime: null });
    render(<KeyPhotoDialog open mode="apply" target={target()} onClose={vi.fn()} />);
    const video = (await screen.findByLabelText('Live Photo clip')) as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { configurable: true, value: 3 });
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1440 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1080 });
    await act(async () => {
      fireEvent.loadedData(video);
    });
    await screen.findByText('0.00 s');
    expect(screen.queryByText('Original')).toBeNull();
    expect(screen.queryByRole('button', { name: /Reset/ })).toBeNull();
    expect(makeButton()).toBeEnabled();
  });

  it('writes the chosen frame and closes', async () => {
    changeKeyPhoto.mockResolvedValue({ clipRewritten: true, exifCopied: true });
    const { onClose, onChanged } = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Next frame' }));
    await screen.findByText('1.60 s');
    fireEvent.click(makeButton());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(changeKeyPhoto).toHaveBeenCalledWith(expect.anything(), 'user-1', expect.objectContaining({ width: 1440 }), 1.6, files);
    expect(onChanged).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it('warns when the clip could not be updated', async () => {
    changeKeyPhoto.mockResolvedValue({ clipRewritten: false, exifCopied: true });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Next frame' }));
    await screen.findByText('1.60 s');
    fireEvent.click(makeButton());
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('motion clip couldn’t be updated')));
  });

  it('says to reload when the photo changed elsewhere, and stays open', async () => {
    changeKeyPhoto.mockRejectedValue(new KeyPhotoConflictError());
    const { onClose } = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Next frame' }));
    await screen.findByText('1.60 s');
    fireEvent.click(makeButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Reload it and try again');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('in pick mode hands the frame back rather than writing it', async () => {
    const { onPicked } = await open({ mode: 'pick' });
    fireEvent.click(screen.getByRole('button', { name: 'Next frame' }));
    await screen.findByText('1.60 s');
    fireEvent.click(makeButton());
    await waitFor(() => expect(onPicked).toHaveBeenCalledWith(expect.objectContaining({ seconds: 1.6, width: 1440, url: 'blob:clip' })));
    expect(changeKeyPhoto).not.toHaveBeenCalled();
  });

  it('offers Revert only once the key photo has been changed', async () => {
    await open();
    expect(screen.queryByRole('button', { name: 'Revert to Original Key Photo' })).toBeNull();
  });

  it('reverts both files through the session', async () => {
    revertToOriginalKeyPhoto.mockResolvedValue(undefined);
    const changed = target({ keyPhoto: { originalVersionId: 'v1' } as KeyPhotoTarget['keyPhoto'] });
    const { onChanged } = await open({ target: changed });
    fireEvent.click(screen.getByRole('button', { name: 'Revert to Original Key Photo' }));
    await waitFor(() => expect(revertToOriginalKeyPhoto).toHaveBeenCalledWith(changed, 'user-1', files));
    expect(onChanged).toHaveBeenCalled();
  });
});
