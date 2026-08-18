'use client';

/**
 * Document properties — the values the metadata field codes read.
 *
 * `{{author}}` has to have somewhere to read an author from, and a document has
 * no author of its own: the signed-in user is whoever opened it, not whoever
 * wrote it, and on a shared document those are routinely different people. So
 * the properties are part of the document, edited here and stored beside the
 * header/footer config in `_meta`.
 *
 * Custom properties are the same thing without a fixed name: add one called
 * `client` and `{{client}}` resolves it. Names are normalised the way a typed
 * field code is, so `Client` and `client` are the same property rather than two
 * that shadow each other invisibly.
 */

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  PROPERTY_CODES,
  canonicalFieldCode,
  emptyDocProperties,
  fieldDef,
  type DocProperties,
  type PropertyCode,
} from '@/lib/docFields';
import styles from './page.module.css';

export interface DocPropertiesModalProps {
  properties: DocProperties;
  onSave: (properties: DocProperties) => void;
  onClose: () => void;
}

const LABELS: Record<PropertyCode, string> = {
  author: 'Author',
  subject: 'Subject',
  company: 'Company',
  category: 'Category',
  keywords: 'Keywords',
  manager: 'Manager',
};

/** Custom rows are edited as a list so a half-typed name is not yet a property. */
interface CustomRow {
  name: string;
  value: string;
}

export function DocPropertiesModal({
  properties: initial,
  onSave,
  onClose,
}: DocPropertiesModalProps) {
  const [draft, setDraft] = useState<DocProperties>(() => ({
    ...emptyDocProperties(),
    ...initial,
  }));
  const [custom, setCustom] = useState<CustomRow[]>(() =>
    Object.entries(initial.custom).map(([name, value]) => ({ name, value })),
  );

  const setBuiltIn = (code: PropertyCode, value: string) =>
    setDraft(prev => ({ ...prev, [code]: value }));

  const setRow = (index: number, patch: Partial<CustomRow>) =>
    setCustom(prev => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const handleSave = () => {
    const merged: Record<string, string> = {};
    for (const row of custom) {
      const code = canonicalFieldCode(row.name);
      // An unnamed row is a row the user started and abandoned, and one named
      // for a built-in code would never be reachable — `{{author}}` resolves the
      // property above, not this. Both are dropped rather than silently kept.
      if (!code || fieldDef(code)) continue;
      merged[code] = row.value;
    }
    onSave({ ...draft, custom: merged });
    onClose();
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalTitle}>Document properties</div>

        <p className={styles.fieldHelp}>
          Insert these into the document with a field code — <code>{'{{author}}'}</code>, or{' '}
          <code>{'{{author:Anonymous}}'}</code> to show <em>Anonymous</em> until this is filled in.
        </p>

        {PROPERTY_CODES.map(code => (
          <div className={styles.formRow} key={code}>
            <label className={styles.formLabel} htmlFor={`doc-prop-${code}`}>
              {LABELS[code]}
            </label>
            <input
              id={`doc-prop-${code}`}
              className={styles.formInput}
              type="text"
              value={draft[code]}
              onChange={e => setBuiltIn(code, e.target.value)}
              placeholder={code === 'keywords' ? 'Comma-separated' : ''}
            />
          </div>
        ))}

        <div className={styles.formRowStack}>
          <label className={styles.formLabel}>Custom properties</label>
          {custom.map((row, index) => (
            <div className={styles.propertyRow} key={index}>
              <input
                className={styles.formInput}
                type="text"
                value={row.name}
                aria-label={`Custom property ${index + 1} name`}
                placeholder="name"
                onChange={e => setRow(index, { name: e.target.value })}
              />
              <input
                className={styles.formInput}
                type="text"
                value={row.value}
                aria-label={`Custom property ${index + 1} value`}
                placeholder="value"
                onChange={e => setRow(index, { value: e.target.value })}
              />
              <button
                type="button"
                className={styles.exportBtn}
                title="Remove this property"
                aria-label={`Remove custom property ${index + 1}`}
                onClick={() => setCustom(prev => prev.filter((_, i) => i !== index))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className={styles.exportBtn}
            onClick={() => setCustom(prev => [...prev, { name: '', value: '' }])}
          >
            <Plus size={13} /> Add property
          </button>
        </div>

        <div className={styles.modalActions}>
          <button className={styles.exportBtn} onClick={onClose}>Cancel</button>
          <button
            className={styles.exportBtn}
            style={{ background: '#1a73e8', color: 'white', border: 'none' }}
            onClick={handleSave}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
