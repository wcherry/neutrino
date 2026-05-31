'use client';

/**
 * TableCellModal — per-cell formatting for the Docs editor tables.
 *
 * Allows users to set:
 *   - Cell background colour
 *   - Border colour
 *   - Border width
 *
 * Requires the AdvancedTableCellExtension to be loaded (which adds the extra
 * attributes to the tableCell node).
 * Gated behind NEXT_PUBLIC_FEATURE_DOCS_ADVANCED_FORMATTING.
 */

import React, { useState } from 'react';
import type { Editor } from '@tiptap/react';
import styles from './page.module.css';

interface Props {
  editor: Editor;
  onClose: () => void;
}

export function TableCellModal({ editor, onClose }: Props) {
  const currentAttrs = editor.getAttributes('tableCell');

  const [bgColor, setBgColor]       = useState<string>(currentAttrs.backgroundColor ?? '');
  const [borderColor, setBorderColor] = useState<string>(currentAttrs.borderColor ?? '');
  const [borderWidth, setBorderWidth] = useState<string>(currentAttrs.borderWidth ?? '');

  const handleApply = () => {
    editor
      .chain()
      .focus()
      .updateAttributes('tableCell', {
        backgroundColor: bgColor  || null,
        borderColor:     borderColor || null,
        borderWidth:     borderWidth || null,
      })
      .run();
    onClose();
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalTitle}>Cell formatting</div>

        {/* Background colour */}
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Background</label>
          <input
            type="color"
            value={bgColor || '#ffffff'}
            onChange={(e) => setBgColor(e.target.value)}
            style={{ height: 34, width: 60, border: '1px solid #e0e0e0', borderRadius: 4, cursor: 'pointer' }}
          />
          {bgColor && (
            <button
              className={styles.exportBtn}
              style={{ marginLeft: 8 }}
              onClick={() => setBgColor('')}
            >
              Clear
            </button>
          )}
        </div>

        {/* Border colour */}
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Border colour</label>
          <input
            type="color"
            value={borderColor || '#e0e0e0'}
            onChange={(e) => setBorderColor(e.target.value)}
            style={{ height: 34, width: 60, border: '1px solid #e0e0e0', borderRadius: 4, cursor: 'pointer' }}
          />
          {borderColor && (
            <button
              className={styles.exportBtn}
              style={{ marginLeft: 8 }}
              onClick={() => setBorderColor('')}
            >
              Clear
            </button>
          )}
        </div>

        {/* Border width */}
        <div className={styles.formRow}>
          <label className={styles.formLabel}>Border width</label>
          <input
            className={styles.formInput}
            value={borderWidth}
            placeholder="e.g. 1px, 2px"
            onChange={(e) => setBorderWidth(e.target.value)}
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
