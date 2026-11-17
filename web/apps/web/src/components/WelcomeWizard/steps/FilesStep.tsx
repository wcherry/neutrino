'use client';

/**
 * Step 6: `<LocalImport>` as Drive's Import folders dialog shows it, with the "From Google" card
 * that leads to the Takeout import. The run belongs to the app-wide `ImportRunProvider`, so it
 * carries on after the wizard closes.
 *
 * Until an import has started, the footer's forward button reads "Skip" — the step's own Import
 * is the primary action. Skipping with files picked but not imported asks first (#331), because
 * the pick lives in this step and leaving drops it.
 */

import React, { useCallback, useRef, useState } from 'react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@neutrino/ui';
import { useImportRun } from '@/components/ImportRun';
import { LocalImportPanel, useLocalImport } from '@/components/LocalImport';
import { useForward, useStep } from '../stepApi';
import styles from './Steps.module.css';

const filesLabel = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'file' : 'files'}`;

export function FilesStep() {
  const { markDone } = useStep();
  const run = useImportRun();
  const local = useLocalImport();
  const [started, setStarted] = useState(false);
  // Resolves the pending guard: true goes on, false stays on the step.
  const answer = useRef<((goOn: boolean) => void) | null>(null);
  const [asking, setAsking] = useState(false);
  const [importing, setImporting] = useState(false);

  // A local run already going (Back into this step after starting one) counts as started.
  const localRun = run.state.status !== 'idle' && run.state.kind === 'local';
  const importStarted = started || localRun;
  const unimported = !importStarted && local.fileCount > 0 ? local.fileCount : 0;

  const onStarted = useCallback(() => {
    setStarted(true);
    markDone();
  }, [markDone]);

  const settle = (goOn: boolean) => {
    setAsking(false);
    answer.current?.(goOn);
    answer.current = null;
  };

  useForward({
    skip: !importStarted,
    guard: unimported
      ? () =>
          new Promise<boolean>((resolve) => {
            answer.current = resolve;
            setAsking(true);
          })
      : undefined,
  });

  const importNow = async () => {
    setImporting(true);
    try {
      const ok = await local.start();
      if (ok) onStarted();
      // When it cannot start (no key on this device, over quota) the panel says why; stay here.
      settle(ok);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className={styles.stack}>
      <LocalImportPanel local={local} showTakeout onStarted={onStarted} />
      <Modal open={asking} onClose={() => settle(false)} size="sm">
        <ModalHeader title={`Skip importing ${filesLabel(unimported)}?`} onClose={() => settle(false)} />
        <ModalBody>
          You&apos;ve chosen files but haven&apos;t started the import. Skipping leaves them on this computer. You
          can import them later from Drive › New › Import folders.
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => settle(true)} disabled={importing}>
            Skip anyway
          </Button>
          <Button variant="primary" onClick={() => void importNow()} loading={importing}>
            Import now
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
