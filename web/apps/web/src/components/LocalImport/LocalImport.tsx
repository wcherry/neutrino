'use client';

/**
 * Bring files and folders from this computer into Neutrino.
 *
 * The reusable panel: Drive's "Import folders" dialog, `/import` (for a local
 * run's progress and results) and the welcome wizard's "Bring your files" step
 * all render this, so it assumes nothing about the page around it. Picking and
 * choosing happen here; the run belongs to `ImportRunProvider` and outlives
 * whatever this is mounted in.
 */

import React from 'react';
import { useImportRun } from '@/components/ImportRun';
import { LocalImportRunStatus } from './LocalImportRunStatus';
import { LocalImportSources } from './LocalImportSources';
import { LocalImportSummary } from './LocalImportSummary';
import { useLocalImport } from './useLocalImport';
import styles from './LocalImport.module.css';

export interface LocalImportProps {
  /** Where the picked folders are recreated. Default `null`, My Drive. */
  defaultFolderId?: string | null;
  /** Default 'My Drive'. */
  defaultFolderName?: string;
  /** Show the "From Google" card linking to the Takeout import. Default true. */
  showTakeout?: boolean;
  /** The run has been handed to the background. */
  onStarted?: () => void;
  className?: string;
}

export function LocalImport({
  defaultFolderId = null,
  defaultFolderName = 'My Drive',
  showTakeout = true,
  onStarted,
  className,
}: LocalImportProps) {
  const run = useImportRun();
  const local = useLocalImport({ defaultFolderId, defaultFolderName });

  const localRun = run.state.status !== 'idle' && run.state.kind === 'local';
  const otherRunning = run.state.status === 'running' && run.state.kind !== 'local';
  const blockedReason = otherRunning
    ? 'A Google Takeout import is running. You can start this one when it has finished.'
    : null;

  const start = async () => {
    if (await local.start()) onStarted?.();
  };

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      {localRun ? (
        <LocalImportRunStatus onImportMore={local.clear} />
      ) : (
        <>
          <p className={styles.intro}>
            Everything is encrypted on this device before it uploads. You can keep using Neutrino while it runs.
          </p>
          <LocalImportSources
            showTakeout={showTakeout}
            scanning={local.scanning}
            disabled={false}
            onPicked={local.addPicked}
            onPickedAsync={(p) => void local.addPickedAsync(p)}
          />
          <LocalImportSummary local={local} blockedReason={blockedReason} onStart={() => void start()} />
          {!local.scan && local.error && <p className={styles.error}>{local.error}</p>}
        </>
      )}
    </div>
  );
}
