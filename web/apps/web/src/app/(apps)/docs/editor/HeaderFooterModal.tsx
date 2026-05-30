'use client';

import React, { useState } from 'react';
import styles from './page.module.css';

export interface HeaderFooterModalProps {
  headerText: string;
  footerText: string;
  showPageNumbers: boolean;
  onSave: (headerText: string, footerText: string, showPageNumbers: boolean) => void;
  onClose: () => void;
}

export function HeaderFooterModal({
  headerText: initialHeader,
  footerText: initialFooter,
  showPageNumbers: initialShowPageNumbers,
  onSave,
  onClose,
}: HeaderFooterModalProps) {
  const [header, setHeader] = useState(initialHeader);
  const [footer, setFooter] = useState(initialFooter);
  const [showPageNums, setShowPageNums] = useState(initialShowPageNumbers);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} style={{ minWidth: 440 }}>
        <div className={styles.modalTitle}>Header &amp; footer</div>

        <div className={styles.formRow} style={{ alignItems: 'flex-start' }}>
          <label className={styles.formLabel} style={{ paddingTop: 6 }}>Header text</label>
          <textarea
            className={styles.formInput}
            style={{ flex: 1, height: 60, resize: 'vertical', padding: '6px 10px', fontFamily: 'inherit' }}
            value={header}
            onChange={(e) => setHeader(e.target.value)}
            placeholder="Header text (use {{page}} for page number)"
          />
        </div>

        <div className={styles.formRow} style={{ alignItems: 'flex-start' }}>
          <label className={styles.formLabel} style={{ paddingTop: 6 }}>Footer text</label>
          <textarea
            className={styles.formInput}
            style={{ flex: 1, height: 60, resize: 'vertical', padding: '6px 10px', fontFamily: 'inherit' }}
            value={footer}
            onChange={(e) => setFooter(e.target.value)}
            placeholder="Footer text (use {{page}} for page number)"
          />
        </div>

        <div className={styles.formRow}>
          <label className={styles.formLabel}>Page numbers</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              id="show-page-numbers"
              checked={showPageNums}
              onChange={(e) => setShowPageNums(e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <label htmlFor="show-page-numbers" style={{ fontSize: 13, cursor: 'pointer', color: 'var(--color-text, #202124)' }}>
              Show page numbers (use <code style={{ fontSize: 11 }}>{'{{page}}'}</code> in header or footer)
            </label>
          </div>
        </div>

        <div className={styles.modalActions}>
          <button className={styles.exportBtn} onClick={onClose}>Cancel</button>
          <button
            className={styles.exportBtn}
            style={{ background: '#1a73e8', color: 'white', border: 'none' }}
            onClick={() => { onSave(header, footer, showPageNums); onClose(); }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
