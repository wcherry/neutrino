'use client';

import React, { useState } from 'react';
import type { Shape } from './types';
import styles from './ExportDialog.module.css';

interface ExportDialogProps {
  shapes: Shape[];
  title: string;
  onClose: () => void;
  onExportPNG: (options: { scale: number; bgColor: string; filename: string }) => Promise<void>;
  onExportSVG: (options: { bgColor: string; filename: string }) => void;
}

type ExportFormat = 'png' | 'svg';

const SCALES = [
  { value: 1, label: '1× — native' },
  { value: 2, label: '2× — retina' },
  { value: 4, label: '4× — high-res' },
];

export function ExportDialog({ shapes, title, onClose, onExportPNG, onExportSVG }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState(2);
  const [bgColor, setBgColor] = useState('#ffffff');
  const [transparent, setTransparent] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filename, setFilename] = useState(title.replace(/[^a-zA-Z0-9_-]/g, '_') || 'drawing');

  const shapeCount = shapes.filter((s) => !s.hidden).length;

  async function handleExport() {
    const effectiveBg = transparent ? '' : bgColor;
    setExporting(true);
    try {
      if (format === 'png') {
        await onExportPNG({ scale, bgColor: effectiveBg, filename });
      } else {
        onExportSVG({ bgColor: effectiveBg, filename });
      }
      onClose();
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog}>
        <h2 className={styles.title}>Export Drawing</h2>
        <p className={styles.meta}>{shapeCount} object{shapeCount !== 1 ? 's' : ''}</p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="exp-format">Format</label>
          <select
            id="exp-format"
            className={styles.select}
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
          >
            <option value="png">PNG — raster image</option>
            <option value="svg">SVG — vector graphic</option>
          </select>
        </div>

        {format === 'png' && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="exp-scale">Resolution</label>
            <select
              id="exp-scale"
              className={styles.select}
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
            >
              {SCALES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="exp-filename">Filename</label>
          <div className={styles.filenameRow}>
            <input
              id="exp-filename"
              className={styles.input}
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              spellCheck={false}
            />
            <span className={styles.ext}>.{format}</span>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="exp-bg">Background</label>
          <div className={styles.colorRow}>
            <input
              id="exp-bg"
              type="color"
              className={styles.colorInput}
              value={bgColor}
              disabled={transparent}
              onChange={(e) => setBgColor(e.target.value)}
            />
            <span className={styles.colorHex}>{bgColor}</span>
          </div>
        </div>

        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={transparent}
            onChange={(e) => setTransparent(e.target.checked)}
          />
          Transparent background
        </label>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button className={styles.exportBtn} onClick={handleExport} disabled={exporting || shapeCount === 0}>
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
