'use client';

import React, { useCallback, useRef, useState } from 'react';
import { useToast } from '@neutrino/ui';
import {
  clipImageName,
  dataUrlToFile,
  readCanvasClip,
  readPastedImage,
  type CanvasClip,
  type PastedCanvasClip,
} from '@/lib/canvasClipboard';
import { CanvasPasteDialog } from '@/components/CanvasPasteDialog/CanvasPasteDialog';

export interface UseRichPasteOptions {
  /** The sheet-selection interceptor's handler, tried first. */
  sheetPaste?: (e: ClipboardEvent) => boolean;
  /** Insert a live embed of a pasted Diagrams or Drawing selection. */
  onLiveCanvas: (clip: CanvasClip) => void;
  /** Store a pasted picture and insert it. Rejections are reported, not thrown. */
  onPicture: (file: File) => Promise<void>;
}

/**
 * The pastes Docs and Slides handle themselves rather than leave to the browser
 * or the editor: a Sheets selection, a Diagrams or Drawing selection, and a
 * lone picture (a screenshot, "Copy image").
 *
 * `handlePaste` is **synchronous** and returns whether it took the event, so the
 * caller can `preventDefault` while that still means something — before the
 * browser or ProseMirror pastes the clipboard's text or HTML as well. Anything
 * slow (the choice dialog, the upload) happens after it has returned.
 */
export function useRichPaste({ sheetPaste, onLiveCanvas, onPicture }: UseRichPasteOptions) {
  const toast = useToast();
  const [pending, setPending] = useState<PastedCanvasClip | null>(null);
  // Read through refs so `handlePaste` keeps one identity — callers register it as a listener.
  const latest = useRef({ sheetPaste, onLiveCanvas, onPicture, toast });
  latest.current = { sheetPaste, onLiveCanvas, onPicture, toast };

  const insertPicture = useCallback((file: File) => {
    latest.current.onPicture(file).catch(() => latest.current.toast.error('Could not paste the picture'));
  }, []);

  const handlePaste = useCallback((e: ClipboardEvent): boolean => {
    const data = e.clipboardData;
    if (!data) return false;
    if (latest.current.sheetPaste?.(e)) return true;

    const clip = readCanvasClip(data);
    if (clip) {
      setPending(clip);
      return true;
    }

    const image = readPastedImage(data);
    if (image) {
      insertPicture(image);
      return true;
    }
    return false;
  }, [insertPicture]);

  const dialog = pending ? (
    <CanvasPasteDialog
      pasted={pending}
      onPasteAsLive={() => latest.current.onLiveCanvas(pending.clip)}
      onPasteAsPicture={() => {
        dataUrlToFile(pending.imageSrc, clipImageName(pending.clip)).then(insertPicture, () =>
          latest.current.toast.error('Could not paste the picture'));
      }}
      onClose={() => setPending(null)}
    />
  ) : null;

  return { handlePaste, dialog };
}
