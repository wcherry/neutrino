'use client';

import React from 'react';
import { Button, Modal, ModalBody, ModalFooter } from '@neutrino/ui';
import type { PastedCanvasClip } from '@/lib/canvasClipboard';
import styles from './CanvasPasteDialog.module.css';

export interface CanvasPasteDialogProps {
  pasted: PastedCanvasClip;
  /** Insert the PNG that came with the copy. */
  onPasteAsPicture: () => void;
  /** Insert a live embed of the copied selection. */
  onPasteAsLive: () => void;
  onClose: () => void;
}

/**
 * The choice a pasted Diagrams or Drawing selection offers — the counterpart of
 * the sheet paste dialog. A **picture** is a copy: it never changes, and it is
 * readable by anyone the document is shared with. A **live** embed draws the
 * source each time, so it follows edits, but only shows for someone who can
 * open the source file — which is why the choice is the user's.
 */
export function CanvasPasteDialog({ pasted, onPasteAsPicture, onPasteAsLive, onClose }: CanvasPasteDialogProps) {
  const { clip, imageSrc } = pasted;
  const noun = clip.kind === 'diagram' ? 'diagram' : 'drawing';
  const source = clip.title || (clip.kind === 'diagram' ? 'Untitled diagram' : 'Untitled drawing');

  return (
    <Modal open onClose={onClose} title={`Paste from ${clip.kind === 'diagram' ? 'Diagrams' : 'Drawing'}`} size="sm">
      <div data-testid="canvas-paste-dialog">
        <ModalBody>
          <div className={styles.preview}>
            {/* A data URL from the clipboard — nothing for next/image to optimise. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageSrc} alt={`Copied from ${source}`} className={styles.image} />
          </div>
          <p className={styles.hint}>
            A live {noun} updates when <strong>{source}</strong> changes, and shows only to people who can open it.
            A picture stays as it is now.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => { onPasteAsPicture(); onClose(); }} data-testid="paste-as-picture-btn">
            Paste as picture
          </Button>
          <Button onClick={() => { onPasteAsLive(); onClose(); }} data-testid="paste-as-live-canvas-btn">
            Paste as live {noun}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
