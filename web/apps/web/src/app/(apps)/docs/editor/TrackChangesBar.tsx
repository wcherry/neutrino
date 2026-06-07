'use client';

import React from 'react';
import type { Editor } from '@tiptap/react';
import { CheckCheck, XCircle, Edit3 } from 'lucide-react';
import styles from './TrackChangesBar.module.css';

interface TrackChangesBarProps {
  editor: Editor;
  suggestingMode: boolean;
  onToggle: () => void;
}

export function TrackChangesBar({ editor, suggestingMode, onToggle }: TrackChangesBarProps) {
  const handleAcceptAll = () => {
    editor.chain().focus().acceptAllChanges().run();
  };

  const handleRejectAll = () => {
    editor.chain().focus().rejectAllChanges().run();
  };

  return (
    <div className={styles.bar} role="toolbar" aria-label="Track changes">
      <button
        className={`${styles.modeBtn} ${suggestingMode ? styles.modeBtnActive : ''}`}
        onClick={onToggle}
        type="button"
        title={suggestingMode ? 'Exit suggesting mode' : 'Enter suggesting mode (track changes)'}
        aria-pressed={suggestingMode}
      >
        <Edit3 size={13} />
        {suggestingMode ? 'Suggesting' : 'Editing'}
      </button>

      {suggestingMode && (
        <>
          <div className={styles.divider} />
          <span className={styles.hint}>Changes are tracked</span>
          <div className={styles.actions}>
            <button
              className={`${styles.actionBtn} ${styles.acceptBtn}`}
              onClick={handleAcceptAll}
              type="button"
              title="Accept all changes"
            >
              <CheckCheck size={13} />
              Accept all
            </button>
            <button
              className={`${styles.actionBtn} ${styles.rejectBtn}`}
              onClick={handleRejectAll}
              type="button"
              title="Reject all changes"
            >
              <XCircle size={13} />
              Reject all
            </button>
          </div>
        </>
      )}
    </div>
  );
}
