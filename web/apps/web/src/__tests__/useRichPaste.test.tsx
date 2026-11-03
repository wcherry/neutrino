/**
 * The paste router Docs and Slides share.
 *
 * The property that matters most is that it decides **synchronously**: a
 * caller can only stop the browser's (or ProseMirror's) own paste by calling
 * `preventDefault` before the event finishes dispatching. The sheet-paste
 * interceptor decided in a promise, and every Sheets selection pasted into a
 * doc arrived twice — once as tab-separated text, once as the table chosen in
 * the dialog.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { ToastProvider } from '@neutrino/ui';
import { useRichPaste, type UseRichPasteOptions } from '@/hooks/useRichPaste';
import { canvasClipHtml, type CanvasClip } from '@/lib/canvasClipboard';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const clip: CanvasClip = { v: 1, kind: 'diagram', fileId: 'd1', title: 'Flow', pageIndex: 0, shapeIds: ['s1'], width: 100, height: 50 };

function pasteEvent(flavours: Record<string, string>, files: File[] = []): ClipboardEvent {
  return {
    clipboardData: {
      getData: (type: string) => flavours[type] ?? '',
      items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
      files,
    },
  } as unknown as ClipboardEvent;
}

function setup(overrides: Partial<UseRichPasteOptions> = {}) {
  const options: UseRichPasteOptions = {
    sheetPaste: vi.fn(() => false),
    onLiveCanvas: vi.fn(),
    onPicture: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  const wrapper = ({ children }: { children: React.ReactNode }) => <ToastProvider>{children}</ToastProvider>;
  const hook = renderHook(() => useRichPaste(options), { wrapper });
  return { options, hook };
}

describe('useRichPaste', () => {
  it('answers synchronously, with a boolean rather than a promise', () => {
    const { hook } = setup();
    const result = hook.result.current.handlePaste(pasteEvent({ 'text/plain': 'hello' }));
    expect(result).toBe(false);
  });

  it('leaves ordinary text and HTML to the editor', () => {
    const { hook, options } = setup();
    expect(hook.result.current.handlePaste(pasteEvent({ 'text/html': '<p>Hi</p>', 'text/plain': 'Hi' }))).toBe(false);
    expect(options.onPicture).not.toHaveBeenCalled();
  });

  it('gives a sheet selection to the sheet interceptor first, and looks no further', () => {
    const sheetPaste = vi.fn(() => true);
    const { hook, options } = setup({ sheetPaste });
    const e = pasteEvent({ 'text/html': canvasClipHtml(clip, PNG) });
    expect(hook.result.current.handlePaste(e)).toBe(true);
    expect(sheetPaste).toHaveBeenCalledWith(e);
    expect(hook.result.current.dialog).toBeNull();
    expect(options.onLiveCanvas).not.toHaveBeenCalled();
  });

  it('takes a copied selection and asks how to paste it', () => {
    const { hook, options } = setup();
    let taken = false;
    act(() => { taken = hook.result.current.handlePaste(pasteEvent({ 'text/html': canvasClipHtml(clip, PNG) })); });
    expect(taken).toBe(true);
    expect(hook.result.current.dialog).not.toBeNull();

    render(<ToastProvider>{hook.result.current.dialog}</ToastProvider>);
    fireEvent.click(screen.getByTestId('paste-as-live-canvas-btn'));
    expect(options.onLiveCanvas).toHaveBeenCalledWith(clip);
  });

  it('takes a lone picture and hands it over to be stored', () => {
    const { hook, options } = setup();
    const shot = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' });
    expect(hook.result.current.handlePaste(pasteEvent({}, [shot]))).toBe(true);
    expect(options.onPicture).toHaveBeenCalledWith(shot);
  });
});
