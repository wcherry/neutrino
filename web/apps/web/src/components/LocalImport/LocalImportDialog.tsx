'use client';

/**
 * Drive's "Import folders" dialog: `<LocalImport>` in a modal, aimed at the
 * folder that is open. Closing it never stops the run — that lives in
 * `ImportRunProvider`, and the progress pill takes over.
 */

import React from 'react';
import { Modal, ModalBody, ModalHeader } from '@neutrino/ui';
import { LocalImport } from './LocalImport';

export interface LocalImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** The open Drive folder; `null` is My Drive. */
  folderId: string | null;
  folderName: string;
}

export function LocalImportDialog({ open, onClose, folderId, folderName }: LocalImportDialogProps) {
  return (
    <Modal open={open} onClose={onClose} size="lg">
      <ModalHeader title="Import folders" onClose={onClose} />
      <ModalBody>
        {open && <LocalImport showTakeout={false} defaultFolderId={folderId} defaultFolderName={folderName} />}
      </ModalBody>
    </Modal>
  );
}
