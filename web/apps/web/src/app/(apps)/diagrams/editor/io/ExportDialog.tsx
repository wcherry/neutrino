'use client';

import React, { useState } from 'react';
import type { DiagramDocument, DiagramPage, Viewport } from '../../types';
import { exportSVG, exportPNG, exportJPEG, exportPNGCropped, exportJPEGCropped, exportSVGCropped, exportJSON, exportMermaid, triggerDownload } from './exportUtils';
import styles from './ExportDialog.module.css';

export type ExportFormat = 'png' | 'jpeg' | 'svg' | 'json' | 'mermaid';
export type RasterSize = 'xl' | 'large' | 'medium' | 'small';

export const RASTER_SIZE_SCALE: Record<RasterSize, number> = {
  xl: 6, large: 4, medium: 2, small: 1,
};

interface ExportDialogProps {
  document: DiagramDocument;
  activePage: DiagramPage;
  canvasContainer: HTMLElement | null;
  title: string;
  onClose: () => void;
  onExportWithRegion?: (format: ExportFormat, filename: string, size: RasterSize, showGrid: boolean, bgColor: string) => void;
}

const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: 'png',     label: 'PNG — Raster image, transparent background' },
  { id: 'jpeg',    label: 'JPEG — Raster image, white background' },
  { id: 'svg',     label: 'SVG — Scalable vector graphic' },
  { id: 'json',    label: 'JSON — Neutrino diagram format' },
  { id: 'mermaid', label: 'Mermaid — Flowchart text' },
];

const SIZES: { id: RasterSize; label: string }[] = [
  { id: 'xl',     label: 'XL — 6× resolution' },
  { id: 'large',  label: 'Large — 4× resolution' },
  { id: 'medium', label: 'Medium — 2× resolution' },
  { id: 'small',  label: 'Small — 1× (native)' },
];

const EXT: Record<ExportFormat, string> = {
  png: 'png', jpeg: 'jpeg', svg: 'svg', json: 'json', mermaid: 'mmd',
};

const FIT_PADDING = 24;

function computeFitRect(
  page: DiagramPage,
  viewport: Viewport,
): { x: number; y: number; width: number; height: number } | null {
  const { zoom, x: vx, y: vy } = viewport;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const expand = (docX: number, docY: number) => {
    const sx = (docX + vx) * zoom;
    const sy = (docY + vy) * zoom;
    if (sx < minX) minX = sx;
    if (sy < minY) minY = sy;
    if (sx > maxX) maxX = sx;
    if (sy > maxY) maxY = sy;
  };

  for (const shape of page.shapes) {
    expand(shape.x, shape.y);
    expand(shape.x + shape.width, shape.y + shape.height);
  }
  for (const conn of page.connectors) {
    if (conn.startPoint) expand(conn.startPoint.x, conn.startPoint.y);
    if (conn.endPoint) expand(conn.endPoint.x, conn.endPoint.y);
    for (const wp of conn.waypoints) expand(wp.x, wp.y);
  }
  for (const stroke of page.strokes ?? []) {
    for (let i = 0; i + 1 < stroke.points.length; i += 2) {
      expand(stroke.points[i], stroke.points[i + 1]);
    }
  }

  if (!isFinite(minX)) return null;

  return {
    x: minX - FIT_PADDING,
    y: minY - FIT_PADDING,
    width: maxX - minX + FIT_PADDING * 2,
    height: maxY - minY + FIT_PADDING * 2,
  };
}

export function ExportDialog({ document, activePage, canvasContainer, title, onClose, onExportWithRegion }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [size, setSize] = useState<RasterSize>('large');
  const [filename, setFilename] = useState(title.replace(/[^a-zA-Z0-9_-]/g, '_') || 'diagram');
  const [showGrid, setShowGrid] = useState(false);
  const [bgColor, setBgColor] = useState('#ffffff');
  const [selectArea, setSelectArea] = useState(false);
  const [exporting, setExporting] = useState(false);

  const isRaster = format === 'png' || format === 'jpeg';
  const isImageFormat = isRaster || format === 'svg';
  const mermaidPreview = format === 'mermaid' ? exportMermaid(activePage) : '';

  async function handleExport() {
    if (selectArea && isImageFormat) {
      onExportWithRegion?.(format, filename, size, showGrid, bgColor);
      onClose();
      return;
    }

    setExporting(true);
    try {
      const fname = filename || 'diagram';
      const scale = RASTER_SIZE_SCALE[size];
      switch (format) {
        case 'png': {
          if (!canvasContainer) return;
          const fitRect = computeFitRect(activePage, document.viewport);
          const blob = fitRect
            ? await exportPNGCropped(canvasContainer, fitRect.x, fitRect.y, fitRect.width, fitRect.height, scale, showGrid, bgColor)
            : await exportPNG(canvasContainer, scale, showGrid, bgColor);
          triggerDownload(blob, `${fname}.png`);
          break;
        }
        case 'jpeg': {
          if (!canvasContainer) return;
          const fitRect = computeFitRect(activePage, document.viewport);
          const blob = fitRect
            ? await exportJPEGCropped(canvasContainer, fitRect.x, fitRect.y, fitRect.width, fitRect.height, scale, showGrid, bgColor)
            : await exportJPEG(canvasContainer, scale, showGrid, bgColor);
          triggerDownload(blob, `${fname}.jpeg`);
          break;
        }
        case 'svg': {
          if (!canvasContainer) return;
          const fitRect = computeFitRect(activePage, document.viewport);
          const svg = fitRect
            ? exportSVGCropped(canvasContainer, fitRect.x, fitRect.y, fitRect.width, fitRect.height, bgColor, showGrid)
            : exportSVG(canvasContainer, bgColor, showGrid);
          triggerDownload(new Blob([svg], { type: 'image/svg+xml' }), `${fname}.svg`);
          break;
        }
        case 'json': {
          const blob = exportJSON(document);
          triggerDownload(blob, `${fname}.json`);
          break;
        }
        case 'mermaid': {
          const text = exportMermaid(activePage);
          triggerDownload(new Blob([text], { type: 'text/plain' }), `${fname}.mmd`);
          break;
        }
      }
      onClose();
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
        <h2 className={styles.title}>Export Diagram</h2>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="export-format">Format</label>
          <select
            id="export-format"
            className={styles.select}
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
          >
            {FORMATS.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </div>

        {isRaster && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="export-size">Size</label>
            <select
              id="export-size"
              className={styles.select}
              value={size}
              onChange={(e) => setSize(e.target.value as RasterSize)}
            >
              {SIZES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="export-filename">Filename</label>
          <div className={styles.filenameRow}>
            <input
              id="export-filename"
              className={styles.input}
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="diagram"
              spellCheck={false}
            />
            <span className={styles.ext}>.{EXT[format]}</span>
          </div>
        </div>

        {isImageFormat && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="export-bgcolor">Background</label>
            <div className={styles.colorRow}>
              <input
                id="export-bgcolor"
                type="color"
                className={styles.colorSwatch}
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
              />
              <span className={styles.colorLabel}>{bgColor}</span>
            </div>
          </div>
        )}

        {isImageFormat && (
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={showGrid}
              onChange={(e) => setShowGrid(e.target.checked)}
            />
            <span>Show gridlines</span>
          </label>
        )}

        {isImageFormat && (
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={selectArea}
              onChange={(e) => setSelectArea(e.target.checked)}
            />
            <span>Draw selection rectangle on export</span>
          </label>
        )}

        {format === 'mermaid' && (
          <pre className={styles.preview}>{mermaidPreview}</pre>
        )}

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button className={styles.exportBtn} onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting…' : (selectArea && isImageFormat ? 'Select Area & Export' : 'Export')}
          </button>
        </div>
      </div>
    </div>
  );
}
