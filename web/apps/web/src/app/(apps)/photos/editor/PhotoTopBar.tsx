'use client';

import React from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { Button } from '@neutrino/ui';
import styles from './page.module.css';

interface PhotoTopBarProps {
  fileName: string;
  isDirty: boolean;
  isSaving: boolean;
  onBack: () => void;
  onSave: () => void;
  onExport: () => void;
}

export function PhotoTopBar({ fileName, isDirty, isSaving, onBack, onSave, onExport }: PhotoTopBarProps) {
  return (
    <div className={styles.topBar}>
      <button className={styles.backBtn} onClick={onBack} title="Back to Drive">
        <ArrowLeft size={18} />
      </button>
      <span className={styles.titleText}>{fileName || 'Photo Editor'}</span>
      <div className={styles.topBarActions}>
        {isDirty && <span className={styles.savingLabel}>Unsaved changes</span>}
        <Button variant="ghost" size="sm" onClick={onExport} icon={<Download size={14} />}>
          Export
        </Button>
        <Button size="sm" onClick={onSave} disabled={isSaving || !isDirty}>
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
