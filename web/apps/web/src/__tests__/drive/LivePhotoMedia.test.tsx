/**
 * The press-and-hold gesture on a Live Photo (issue #316): a hold loops the
 * clip until release, a short click is still a click, and a click that ends a
 * hold does not also open anything.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

vi.mock('@neutrino/auth', () => ({ useUser: () => ({ id: 'user-1' }) }));
vi.mock('@/hooks/useSessionKeyPair', () => ({ useSessionKeyPair: () => ({ publicKey: 'pk' }) }));
vi.mock('../../app/(apps)/drive/LivePhotoMedia.module.css', () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));

const verdicts = new Map<string, boolean>();
const loadLiveClip = vi.fn();
vi.mock('@/lib/livePhotos/clipLoader', () => ({
  clipVerdict: (key: string) => verdicts.get(key),
  subscribeToClipVerdicts: () => () => {},
  loadLiveClip: (...a: unknown[]) => loadLiveClip(...a),
}));

import { LivePhotoMedia, HOLD_DELAY_MS } from '../../app/(apps)/drive/LivePhotoMedia';
import type { FileClip } from '@/lib/livePhotos/pairing';

const clip: FileClip = {
  kind: 'file',
  fileId: 'clip-1',
  mimeType: 'video/quicktime',
  sizeBytes: 1,
  via: 'link',
  confirmed: true,
  subtype: 'live_photo_apple',
};

// jsdom has no PointerEvent, so `fireEvent.pointerDown` would build a plain
// Event and drop `pointerType` — the field the muting rule reads.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}

const play = vi.fn(async () => {});
const pause = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  verdicts.clear();
  loadLiveClip.mockReset();
  loadLiveClip.mockResolvedValue(new Blob([new Uint8Array([1])], { type: 'video/quicktime' }));
  play.mockClear();
  pause.mockClear();
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pause });
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:clip');
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A grid card: the tile inside something clickable, as `FileGrid` draws it. */
function Tile({ onOpen, confirmed = true }: { onOpen: () => void; confirmed?: boolean }) {
  return (
    <div role="listitem" tabIndex={0} onClick={onOpen} data-testid="card">
      <LivePhotoMedia variant="tile" stillId="still-1" clip={{ ...clip, confirmed }} src="thumb.jpg" alt="IMG_1.HEIC" />
    </div>
  );
}

function root() {
  return document.querySelector('[data-live-state]') as HTMLElement;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('LivePhotoMedia', () => {
  it('shows a LIVE badge that is a button saying what it does', () => {
    render(<Tile onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'Hold to play Live Photo' })).toHaveTextContent('LIVE');
  });

  it('loops the clip while held and stops on release, without opening the file', async () => {
    const onOpen = vi.fn();
    render(<Tile onOpen={onOpen} />);
    const img = screen.getByAltText('IMG_1.HEIC');

    fireEvent.pointerDown(img, { isPrimary: true, button: 0, pointerType: 'mouse' });
    // A tile starts fetching on the press, not before.
    expect(loadLiveClip).toHaveBeenCalledTimes(1);
    await flush();
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS));

    expect(root().dataset.liveState).toBe('playing');
    const video = document.querySelector('video')!;
    expect(video.loop).toBe(true);
    expect(play).toHaveBeenCalled();
    // A mouse press is user activation: sound on.
    expect(video.muted).toBe(false);

    fireEvent.pointerUp(img, { isPrimary: true, button: 0, pointerType: 'mouse' });
    fireEvent.click(img);
    expect(root().dataset.liveState).toBe('idle');
    expect(pause).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('lets a short click through to the card', async () => {
    const onOpen = vi.fn();
    render(<Tile onOpen={onOpen} />);
    const img = screen.getByAltText('IMG_1.HEIC');
    fireEvent.pointerDown(img, { isPrimary: true, button: 0, pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS - 50));
    fireEvent.pointerUp(img, { isPrimary: true, button: 0, pointerType: 'mouse' });
    fireEvent.click(img);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(root().dataset.liveState).toBe('idle');
  });

  it('starts muted on touch, where activation only arrives at release', async () => {
    render(<Tile onOpen={() => {}} />);
    const img = screen.getByAltText('IMG_1.HEIC');
    fireEvent.pointerDown(img, { isPrimary: true, button: 0, pointerType: 'touch' });
    await flush();
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS));
    expect(document.querySelector('video')!.muted).toBe(true);
  });

  it.each([
    ['pointercancel', (el: HTMLElement) => fireEvent.pointerCancel(el)],
    ['pointerleave', (el: HTMLElement) => fireEvent.pointerLeave(el)],
    ['window blur', () => fireEvent.blur(window)],
  ])('treats %s as a release', async (_name, release) => {
    render(<Tile onOpen={() => {}} />);
    const img = screen.getByAltText('IMG_1.HEIC');
    fireEvent.pointerDown(img, { isPrimary: true, button: 0, pointerType: 'mouse' });
    await flush();
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS));
    expect(root().dataset.liveState).toBe('playing');
    act(() => release(root()));
    expect(root().dataset.liveState).toBe('idle');
  });

  it('blocks the long-press menu and native image drag on a Live Photo', () => {
    render(<Tile onOpen={() => {}} />);
    const img = screen.getByAltText('IMG_1.HEIC');
    expect(img.getAttribute('draggable')).toBe('false');
    expect(fireEvent.contextMenu(img)).toBe(false);
  });

  it('holding Space on the focused card loops the clip; a tap of Space still opens it', async () => {
    const onOpen = vi.fn();
    render(<Tile onOpen={onOpen} />);
    const card = screen.getByTestId('card');

    fireEvent.keyDown(card, { key: ' ' });
    await flush();
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS));
    expect(root().dataset.liveState).toBe('playing');
    fireEvent.keyUp(card, { key: ' ' });
    expect(root().dataset.liveState).toBe('idle');
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.keyDown(card, { key: ' ' });
    fireEvent.keyUp(card, { key: ' ' });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('does not eat a real click that follows a hold which had no click of its own', async () => {
    const onOpen = vi.fn();
    render(<Tile onOpen={onOpen} />);
    const card = screen.getByTestId('card');
    const img = screen.getByAltText('IMG_1.HEIC');

    // A Space hold ends on keyup, with no click after it…
    fireEvent.keyDown(card, { key: ' ' });
    await flush();
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS));
    fireEvent.keyUp(card, { key: ' ' });
    // …so a click straight afterwards is a click.
    fireEvent.pointerDown(img, { isPrimary: true, button: 0, pointerType: 'mouse' });
    fireEvent.pointerUp(img, { isPrimary: true, button: 0, pointerType: 'mouse' });
    fireEvent.click(img);
    expect(onOpen).toHaveBeenCalledTimes(1);

    // Likewise after a pointer hold that ended by leaving the tile.
    fireEvent.pointerDown(img, { isPrimary: true, button: 0, pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS));
    fireEvent.pointerLeave(root());
    fireEvent.pointerDown(img, { isPrimary: true, button: 0, pointerType: 'mouse' });
    fireEvent.pointerUp(img, { isPrimary: true, button: 0, pointerType: 'mouse' });
    fireEvent.click(img);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('shows no badge for a name-only match until its bytes confirm it', () => {
    render(<Tile onOpen={() => {}} confirmed={false} />);
    expect(screen.queryByRole('button', { name: 'Hold to play Live Photo' })).toBeNull();
  });

  it('is a plain picture once the clip turned out to be an ordinary video', async () => {
    verdicts.set('clip-1', false);
    const onOpen = vi.fn();
    render(<Tile onOpen={onOpen} confirmed={false} />);
    const img = screen.getByAltText('IMG_1.HEIC');
    fireEvent.pointerDown(img, { isPrimary: true, button: 0, pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS * 2));
    expect(loadLiveClip).not.toHaveBeenCalled();
    expect(root().dataset.liveState).toBe('idle');
    fireEvent.click(img);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
