/**
 * Keeps a document's Drive preview in step with its first page.
 *
 * An editor describes its first page as a **signature** — a string built from
 * the model, cheap to compute, equal whenever page one would look the same —
 * and hands it over at two moments: when the document has loaded (`loaded`),
 * and after each successful save (`saved`). The picture is redrawn and stored
 * only when the signature moves, or when the file has no preview at all, so an
 * edit on page nine of a long document never re-renders page one and an
 * autosave loop does not upload a JPEG every three seconds.
 *
 * Rendering is the editor's (`render`, see `lib/documentPreview.ts`) and runs
 * when the browser is idle, one at a time: a signature that changes again
 * while a render is in flight is picked up by one more render after it, never
 * by two at once. A preview is a nicety — every failure is logged and dropped,
 * and the signature is rolled back so the next save tries again.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { driveSetThumbnail } from '@neutrino/api-drive';

export interface DocumentPreviewOptions {
  /** Draws page one as an image, or null when there is nothing to draw yet. */
  render: () => Promise<Blob | null>;
  /**
   * False for a viewer or commenter: the server refuses their upload, so this
   * does not try. A save only happens with edit access anyway; this is for the
   * backfill `loaded` would otherwise attempt.
   */
  canEdit?: boolean;
}

export interface DocumentPreview {
  /**
   * The document is on screen. Records `signature` as what the stored preview
   * shows, and draws one now if the file has none — which is how documents
   * written before previews existed get one without waiting for an edit.
   */
  loaded: (signature: string, hasPreview: boolean) => void;
  /** A save landed. Redraws when page one changed, or when there is no preview. */
  saved: (signature: string, hasPreview: boolean) => void;
}

/** How long to wait for an idle moment before rendering anyway. */
const IDLE_TIMEOUT_MS = 2_000;

function whenIdle(run: () => void): void {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
  } else {
    setTimeout(run, 0);
  }
}

export function useDocumentPreview(
  fileId: string | null | undefined,
  options: DocumentPreviewOptions,
): DocumentPreview {
  const renderRef = useRef(options.render);
  const canEditRef = useRef(options.canEdit ?? true);
  useEffect(() => {
    renderRef.current = options.render;
    canEditRef.current = options.canEdit ?? true;
  });

  // What the stored preview shows; null until the editor says.
  const shownRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  // The newest signature asked for while a render was in flight.
  const pendingRef = useRef<string | null>(null);

  const draw = useCallback(
    (signature: string) => {
      if (!fileId || !canEditRef.current) return;
      if (runningRef.current) {
        pendingRef.current = signature;
        return;
      }
      runningRef.current = true;
      const previous = shownRef.current;
      // Claimed up front so a save landing mid-render does not queue a
      // second render of the same page.
      shownRef.current = signature;
      whenIdle(async () => {
        try {
          const image = await renderRef.current();
          if (!image) {
            shownRef.current = previous;
            return;
          }
          // No invalidation here: the upload is a Drive write, so the server's
          // drive-events signal refreshes every open listing, this tab's too.
          await driveSetThumbnail(fileId, image);
        } catch (err) {
          shownRef.current = previous;
          console.warn('[preview] could not store a preview for', fileId, err);
        } finally {
          runningRef.current = false;
          const next = pendingRef.current;
          pendingRef.current = null;
          if (next !== null && next !== shownRef.current) draw(next);
        }
      });
    },
    [fileId],
  );

  const loaded = useCallback(
    (signature: string, hasPreview: boolean) => {
      if (shownRef.current !== null) return;
      if (hasPreview) {
        shownRef.current = signature;
      } else {
        draw(signature);
      }
    },
    [draw],
  );

  const saved = useCallback(
    (signature: string, hasPreview: boolean) => {
      if (hasPreview && signature === shownRef.current) return;
      draw(signature);
    },
    [draw],
  );

  return useMemo(() => ({ loaded, saved }), [loaded, saved]);
}
