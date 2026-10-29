'use client';

/**
 * Step 6: `<LocalImport>` as Drive's Import folders dialog shows it, with the "From Google" card
 * that leads to the Takeout import. The run belongs to the app-wide `ImportRunProvider`, so it
 * carries on after the wizard closes.
 */

import React from 'react';
import { LocalImport } from '@/components/LocalImport';
import { useStep } from '../stepApi';
import styles from './Steps.module.css';

export function FilesStep() {
  const { markDone } = useStep();
  return (
    <div className={styles.stack}>
      <LocalImport showTakeout onStarted={markDone} />
    </div>
  );
}
