'use client';

import React, { useState } from 'react';
import type { DrawingDocument } from './types';
import { flattenTree } from './document/tree';
import styles from './ExportDialog.module.css';

/**
 * PNG and SVG are pictures of the drawing. OpenRaster is the drawing — layers,
 * groups, opacities, blend modes and masks intact, openable in Krita or GIMP.
 *
 * It exports rather than saves. Nothing can *read* an `.ora` back yet (redesign
 * phase 3), and a Drive file this app writes and cannot open would be a trap;
 * the drawing itself stays in its own format until the reader lands.
 */
export type ExportFormat = 'png' | 'svg' | 'ora';

export interface PngExportOptions {
  scale: number;
  background: string | null;
  filename: string;
}

export interface SvgExportOptions {
  background: string | null;
  filename: string;
}

export interface OraExportOptions {
  background: string | null;
  filename: string;
}

interface ExportDialogProps {
  doc: DrawingDocument;
  onClose: () => void;
  onExportPNG: (options: PngExportOptions) => Promise<void>;
  onExportSVG: (options: SvgExportOptions) => void;
  onExportORA: (options: OraExportOptions) => Promise<void>;
}

const SCALES = [
  { value: 1, label: '1× — native' },
  { value: 2, label: '2× — retina' },
  { value: 4, label: '4× — high-res' },
];

const EXTENSIONS: Record<ExportFormat, string> = { png: 'png', svg: 'svg', ora: 'ora' };

export function ExportDialog({ doc, onClose, onExportPNG, onExportSVG, onExportORA }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState(2);
  const [bgColor, setBgColor] = useState(doc.canvas.background ?? '#ffffff');
  const [transparent, setTransparent] = useState(doc.canvas.background === null);
  const [exporting, setExporting] = useState(false);
  const [filename, setFilename] = useState(
    doc.metadata.title.replace(/[^a-zA-Z0-9_-]/g, '_') || 'drawing',
  );

  const rows = flattenTree(doc.root);
  const layerCount = rows.filter(({ node }) => node.type !== 'stack').length;
  const objectCount = rows.reduce(
    (total, { node }) => total + (node.type === 'vector' ? node.objects.length : node.type === 'stack' ? 0 : 1),
    0,
  );

  async function handleExport() {
    const background = transparent ? null : bgColor;
    setExporting(true);
    try {
      if (format === 'png') await onExportPNG({ scale, background, filename });
      else if (format === 'svg') onExportSVG({ background, filename });
      else await onExportORA({ background, filename });
      onClose();
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog}>
        <h2 className={styles.title}>Export Drawing</h2>
        <p className={styles.meta}>
          {doc.canvas.width} × {doc.canvas.height} px · {layerCount} layer{layerCount !== 1 ? 's' : ''} ·{' '}
          {objectCount} object{objectCount !== 1 ? 's' : ''}
        </p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="exp-format">Format</label>
          <select
            id="exp-format"
            className={styles.select}
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
          >
            <option value="png">PNG — flattened image</option>
            <option value="svg">SVG — vector graphic</option>
            <option value="ora">OpenRaster — layered document</option>
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

        {format === 'ora' && (
          <p className={styles.note}>
            Keeps every layer, group, opacity, blend mode and mask. Opens in Krita, GIMP and
            other OpenRaster applications.
          </p>
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
            <span className={styles.ext}>.{EXTENSIONS[format]}</span>
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
          <button
            className={styles.exportBtn}
            onClick={handleExport}
            disabled={exporting || objectCount === 0}
          >
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
