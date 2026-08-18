'use client';

/**
 * Insert a field, with a fallback.
 *
 * The Insert menu covers the plain cases directly; this is here for the two it
 * cannot: giving a field a fallback, and pointing one at a custom property the
 * menu has never heard of. It previews the token it will insert, because the
 * token is also what a user can type by hand — seeing `{{author:My Self}}` once
 * is how the syntax gets learned.
 */

import React, { useState } from 'react';
import {
  FIELD_DEFS,
  canonicalFieldCode,
  fieldDef,
  formatFieldToken,
} from '@/lib/docFields';
import styles from './page.module.css';

export interface InsertFieldDialogProps {
  onInsert: (code: string, arg: string | null) => void;
  onClose: () => void;
}

const CUSTOM = '__custom__';

export function InsertFieldDialog({ onInsert, onClose }: InsertFieldDialogProps) {
  const [choice, setChoice] = useState<string>('title');
  const [customCode, setCustomCode] = useState('');
  const [fallback, setFallback] = useState('');

  const code = canonicalFieldCode(choice === CUSTOM ? customCode : choice);
  const arg = fallback.trim() || null;
  const valid = /^[a-z][a-z0-9_-]*$/.test(code);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalTitle}>Insert field</div>

        <div className={styles.formRow}>
          <label className={styles.formLabel} htmlFor="insert-field-code">Field</label>
          <select
            id="insert-field-code"
            className={styles.formInput}
            value={choice}
            onChange={e => setChoice(e.target.value)}
          >
            {FIELD_DEFS.map(def => (
              <option key={def.code} value={def.code}>
                {def.label} — {def.hint}
              </option>
            ))}
            <option value={CUSTOM}>Custom property…</option>
          </select>
        </div>

        {choice === CUSTOM && (
          <div className={styles.formRowStack}>
            <label className={styles.formLabel} htmlFor="insert-field-custom">Property name</label>
            <input
              id="insert-field-custom"
              className={styles.formInput}
              type="text"
              value={customCode}
              placeholder="e.g. client"
              onChange={e => setCustomCode(e.target.value)}
            />
            <p className={styles.fieldHelp}>
              Set its value under <strong>File → Document properties</strong>.
            </p>
          </div>
        )}

        <div className={styles.formRow}>
          <label className={styles.formLabel} htmlFor="insert-field-fallback">
            Show this when it has no value
          </label>
          <input
            id="insert-field-fallback"
            className={styles.formInput}
            type="text"
            value={fallback}
            placeholder="Optional"
            onChange={e => setFallback(e.target.value)}
          />
        </div>

        <p className={styles.fieldHelp}>
          Inserts <code>{valid ? formatFieldToken({ code, arg }) : '—'}</code>
          {valid && !fieldDef(code) ? ' (custom property)' : ''}. You can also type it straight
          into the document.
        </p>

        <div className={styles.modalActions}>
          <button className={styles.exportBtn} onClick={onClose}>Cancel</button>
          <button
            className={styles.exportBtn}
            style={{ background: '#1a73e8', color: 'white', border: 'none' }}
            disabled={!valid}
            onClick={() => { onInsert(code, arg); onClose(); }}
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
