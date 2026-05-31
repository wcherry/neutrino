'use client';

/**
 * ImagePropertiesModal — lets users configure image width, alignment, alt text,
 * and caption for a selected image in the Docs editor.
 *
 * Requires the AdvancedImageExtension to be loaded (which adds the extra attrs).
 * Gated behind NEXT_PUBLIC_FEATURE_DOCS_ADVANCED_FORMATTING.
 */

import React, { useState } from 'react';
import type { Editor } from '@tiptap/react';
import styles from './page.module.css';

export interface ImageAttrs {
  src?: string;
  width?: string | null;
  alignment?: string;
  alt?: string;
  caption?: string;
}

interface Props {
  editor: Editor;
  /** Current attribute values to pre-fill the form. */
  initialAttrs: ImageAttrs;
  onClose: () => void;
}

const ALIGNMENT_OPTIONS = [
  { value: 'none',        label: 'Default' },
  { value: 'left',        label: 'Left (block)' },
  { value: 'center',      label: 'Center' },
  { value: 'right',       label: 'Right (block)' },
  { value: 'float-left',  label: 'Float left' },
  { value: 'float-right', label: 'Float right' },
];

export function ImagePropertiesModal({ editor, initialAttrs, onClose }: Props) {
  const [width, setWidth]         = useState(initialAttrs.width ?? '');
  const [alignment, setAlignment] = useState(initialAttrs.alignment ?? 'none');
  const [alt, setAlt]             = useState(initialAttrs.alt ?? '');
  const [caption, setCaption]     = useState(initialAttrs.caption ?? '');

  const handleApply = () => {
    editor
      .chain()
      .focus()
      .updateAttributes('image', {
        width:     width || null,
        alignment: alignment || 'none',
        alt:       alt || null,
        caption:   caption || '',
      })
      .run();
    onClose();
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalTitle}>Image properties</div>

        <div className={styles.formRow}>
          <label className={styles.formLabel}>Width</label>
          <input
            className={styles.formInput}
            value={width}
            placeholder="e.g. 300px, 50%, auto"
            onChange={(e) => setWidth(e.target.value)}
          />
        </div>

        <div className={styles.formRow}>
          <label className={styles.formLabel}>Alignment</label>
          <select
            className={styles.formSelect}
            value={alignment}
            onChange={(e) => setAlignment(e.target.value)}
          >
            {ALIGNMENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.formRow}>
          <label className={styles.formLabel}>Alt text</label>
          <input
            className={styles.formInput}
            value={alt}
            placeholder="Describe the image for accessibility"
            onChange={(e) => setAlt(e.target.value)}
          />
        </div>

        <div className={styles.formRow}>
          <label className={styles.formLabel}>Caption</label>
          <input
            className={styles.formInput}
            value={caption}
            placeholder="Optional caption text"
            onChange={(e) => setCaption(e.target.value)}
          />
        </div>

        <div className={styles.modalActions}>
          <button className={styles.exportBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.exportBtn}
            style={{ background: '#1a73e8', color: 'white', border: 'none' }}
            onClick={handleApply}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
