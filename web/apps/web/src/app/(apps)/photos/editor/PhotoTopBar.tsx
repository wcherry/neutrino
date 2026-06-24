'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { HamburgerMenu } from '@neutrino/ui';
import type { HamburgerMenuItem } from '@neutrino/ui';
import styles from './page.module.css';

interface PhotoTopBarProps {
  fileName: string;
  isDirty: boolean;
  isSaving: boolean;
  hasSelection: boolean;
  hasClipboard: boolean;
  onBack: () => void;
  onSave: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}

export function PhotoTopBar({ fileName, isDirty, isSaving, hasSelection, hasClipboard, onBack, onSave, onDuplicate, onExport, onCut, onCopy, onPaste, onDelete, onRename }: PhotoTopBarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(fileName || 'Photo Editor');
    setEditing(true);
  };

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commitEdit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== fileName) onRename(trimmed);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditing(false);
  };

  const items: HamburgerMenuItem[] = [
    {
      kind: 'submenu',
      label: 'File',
      items: [
        { kind: 'action', label: isSaving ? 'Saving…' : 'Save', disabled: !isDirty || isSaving, action: onSave },
        { kind: 'action', label: 'Duplicate', action: onDuplicate },
        { kind: 'action', label: 'Export', action: onExport },
      ],
    },
    {
      kind: 'submenu',
      label: 'Edit',
      items: [
        { kind: 'action', label: 'Cut', disabled: !hasSelection, action: onCut },
        { kind: 'action', label: 'Copy', disabled: !hasSelection, action: onCopy },
        { kind: 'action', label: 'Paste', disabled: !hasClipboard, action: onPaste },
        { kind: 'separator' },
        { kind: 'action', label: 'Delete', disabled: !hasSelection, action: onDelete },
      ],
    },
  ];

  return (
    <div className={styles.topBar}>
      <HamburgerMenu items={items} />
      <button className={styles.backBtn} onClick={onBack} title="Back to Drive">
        <ArrowLeft size={18} />
      </button>
      {editing ? (
        <input
          ref={inputRef}
          className={styles.titleInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <span className={styles.titleText} onClick={startEdit} title="Click to rename">
          {fileName || 'Photo Editor'}
        </span>
      )}
      {isDirty && <span className={styles.savingLabel}>Unsaved changes</span>}
    </div>
  );
}
