'use client';

/**
 * The toolbar that replaces the document toolbar while a header or footer is
 * being edited — the contextual ribbon a word processor shows in the same
 * situation.
 *
 * It acts on whichever band the caret is in: the field buttons insert into that
 * field, "Remove" clears that band, and the label names the variant so it is
 * never ambiguous which of the three headers is being typed into. The two
 * switches and the two margins are document-wide and stay live here because
 * they are the settings you reach for while looking at the band they change.
 */

import React from 'react';
import { CalendarDays, FileText, Hash, PanelBottom, PanelTop, Trash2, X } from 'lucide-react';
import {
  variantForPage,
  variantLabel,
  type FieldName,
  type HeaderFooterBand,
  type HeaderFooterConfig,
} from '@/lib/docHeaderFooter';
import type { HeaderFooterFocus } from './HeaderFooterLayer';
import styles from './HeaderFooterToolbar.module.css';

export interface HeaderFooterToolbarProps {
  config: HeaderFooterConfig;
  focus: HeaderFooterFocus;
  onToggleDifferentFirstPage: (value: boolean) => void;
  onToggleDifferentEvenOdd: (value: boolean) => void;
  /** Band offset from the sheet edge, in points — as `PageSetup` margins are. */
  onMarginChange: (band: HeaderFooterBand, points: number) => void;
  onInsertField: (field: FieldName) => void;
  onGoToBand: (band: HeaderFooterBand) => void;
  onClearBand: () => void;
  onClose: () => void;
}

// PageSetupModal shows the page margins the same way.
const POINTS_PER_INCH = 72;

const FIELD_BUTTONS: { field: FieldName; label: string; icon: React.ReactNode; title: string }[] = [
  { field: 'page', label: 'Page number', icon: <Hash size={13} />, title: 'Insert the page number' },
  { field: 'pages', label: 'Page count', icon: <FileText size={13} />, title: 'Insert the total page count' },
  { field: 'date', label: 'Date', icon: <CalendarDays size={13} />, title: "Insert today's date" },
  { field: 'title', label: 'Title', icon: <FileText size={13} />, title: 'Insert the document title' },
];

export function HeaderFooterToolbar({
  config,
  focus,
  onToggleDifferentFirstPage,
  onToggleDifferentEvenOdd,
  onMarginChange,
  onInsertField,
  onGoToBand,
  onClearBand,
  onClose,
}: HeaderFooterToolbarProps) {
  const variant = variantForPage(focus.page, config);
  const label = variantLabel(variant, focus.band, config);

  const marginInput = (band: HeaderFooterBand, text: string) => {
    const points = band === 'header' ? config.headerMargin : config.footerMargin;
    return (
      <label className={styles.numberField}>
        {text}
        <input
          type="number"
          className={styles.number}
          value={(points / POINTS_PER_INCH).toFixed(2)}
          min={0}
          max={3}
          step={0.05}
          aria-label={text}
          onChange={e => {
            const inches = parseFloat(e.target.value);
            if (Number.isFinite(inches)) {
              onMarginChange(band, Math.max(0, Math.min(3, inches)) * POINTS_PER_INCH);
            }
          }}
        />
        <span className={styles.unit}>&Prime;</span>
      </label>
    );
  };

  return (
    <div className={styles.bar} role="toolbar" aria-label="Header and footer tools">
      <span className={styles.title}>{label}</span>

      <div className={styles.divider} />

      <div className={styles.group} role="group" aria-label="Go to">
        <button
          type="button"
          className={`${styles.btn} ${focus.band === 'header' ? styles.btnActive : ''}`}
          onClick={() => onGoToBand('header')}
          title="Go to the header on this page"
        >
          <PanelTop size={13} /> Header
        </button>
        <button
          type="button"
          className={`${styles.btn} ${focus.band === 'footer' ? styles.btnActive : ''}`}
          onClick={() => onGoToBand('footer')}
          title="Go to the footer on this page"
        >
          <PanelBottom size={13} /> Footer
        </button>
      </div>

      <div className={styles.divider} />

      <div className={styles.group} role="group" aria-label="Insert field">
        <span className={styles.groupLabel}>Insert</span>
        {FIELD_BUTTONS.map(b => (
          <button
            key={b.field}
            type="button"
            className={styles.btn}
            title={b.title}
            // Insertion needs the caret still in the field, and a click moves
            // focus before onClick fires — so act on mousedown and never take
            // focus at all.
            onMouseDown={e => {
              e.preventDefault();
              onInsertField(b.field);
            }}
          >
            {b.icon} {b.label}
          </button>
        ))}
      </div>

      <div className={styles.divider} />

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={config.differentFirstPage}
          onChange={e => onToggleDifferentFirstPage(e.target.checked)}
        />
        Different first page
      </label>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={config.differentEvenOdd}
          onChange={e => onToggleDifferentEvenOdd(e.target.checked)}
        />
        Different odd &amp; even
      </label>

      <div className={styles.divider} />

      {marginInput('header', 'Header from top')}
      {marginInput('footer', 'Footer from bottom')}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.btn}
          onMouseDown={e => e.preventDefault()}
          onClick={onClearBand}
          title={`Clear the ${focus.band} on this page`}
        >
          <Trash2 size={13} /> Remove
        </button>
        <button type="button" className={styles.closeBtn} onClick={onClose} title="Close (Esc)">
          <X size={13} /> Close
        </button>
      </div>
    </div>
  );
}
