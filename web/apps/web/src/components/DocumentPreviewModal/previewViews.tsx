'use client';

/**
 * The drawing half of every document preview: given a document's decrypted body, show it.
 *
 * Split out of `DocumentPreviewModal` so two previews share one renderer per type — Drive's, which
 * fetches with the signed-in user's key, and the folder-link preview on `/share` (#321), which
 * decrypts with the link's key. Neither fetches here; each passes in what it read.
 */

import React from 'react';
import { Text } from '@neutrino/ui';
import { escapeHtml, tiptapJsonToHtml } from '@/lib/tiptapHtml';
import { NoteBlocks } from '@/app/(apps)/notes/NoteBlocks';

import {
  slideBackgroundStyle,
} from '@/app/(apps)/slides/editor/slideEditorHelpers';

import {
  ShapeRenderer,
} from '@/app/(apps)/slides/editor/SlideCanvas';

import type {
  SlidePresentation,
  TextElement,
  ShapeElement,
} from '@/app/(apps)/slides/editor/slideEditorTypes';

import type { SheetFile, CellProps } from '@/app/(apps)/sheets/editor/types';
import { computeCell } from '@/app/(apps)/sheets/editor/formula';
import { numToAlpha } from '@/app/(apps)/sheets/editor/utils';

import { EmbeddedDiagramView } from '@/app/(apps)/diagrams/editor/EmbeddedDiagramView';
import type { DiagramDocument } from '@/app/(apps)/diagrams/types';

import { parseDocument as parseDrawing } from '@/app/(apps)/drawing/editor/document/serialize';
import { documentToSvg as drawingToSvg } from '@/app/(apps)/drawing/editor/render/documentSvg';
import { isDocumentEmpty as drawingIsEmpty } from '@/app/(apps)/drawing/editor/document/tree';
import styles from './DocumentPreviewModal.module.css';

const PREVIEW_MAX_ROWS = 50;
const PREVIEW_MAX_COLS = 26;

/** A document's stored body (Tiptap JSON text) as read-only HTML. */
export function DocView({ content }: { content: string }) {
  // The doc content is a Tiptap JSON document. Parse and extract an HTML-like
  // structure for read-only rendering without loading the full editor bundle.
  // Docs saved with the layout-structure feature (see DocEditor.tsx) wrap the
  // Tiptap doc as `{ doc, _meta }` — unwrap it the same way before rendering.
  let html = '';
  try {
    const parsed = JSON.parse(content);
    const json = parsed && typeof parsed === 'object' && parsed._meta && parsed.doc ? parsed.doc : parsed;
    html = tiptapJsonToHtml(json);
  } catch {
    html = `<p>${escapeHtml(content)}</p>`;
  }

  return (
    <div
      className={styles.docContent}
      // We produce the HTML ourselves from the Tiptap JSON; it is not user-
      // supplied HTML so dangerouslySetInnerHTML is safe here.
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** A spreadsheet body (the editor's `SheetFile` JSON): its first sheet as a table. */
export function SheetView({ content }: { content: string }) {
  let sheetData: SheetFile | null = null;
  try {
    sheetData = JSON.parse(content) as SheetFile;
  } catch {
    return (
      <div className={styles.centered}>
        <Text color="muted">Could not parse spreadsheet content.</Text>
      </div>
    );
  }

  const firstSheet = sheetData?.sheets?.[0];
  if (!firstSheet) {
    return (
      <div className={styles.centered}>
        <Text color="muted">This spreadsheet is empty.</Text>
      </div>
    );
  }

  // Build a cell map and resolve computed values
  const cellMap = new Map<string, CellProps>(
    Object.values(firstSheet.cells ?? {}).map((c) => [
      c.id,
      { id: c.id, raw: c.raw, edit: false, cellStyle: c.cellStyle },
    ])
  );
  for (const [, cell] of cellMap) {
    const { value } = computeCell(cell.raw ?? '', cellMap);
    cell.value = value;
  }

  // Determine the bounds of used cells (capped at preview limits)
  let maxRow = 0;
  let maxCol = 0;
  for (const id of cellMap.keys()) {
    const match = id.match(/^([A-Z]+)(\d+)$/);
    if (!match) continue;
    const col = alphaToColIndex(match[1]);
    const row = parseInt(match[2], 10);
    if (row > maxRow) maxRow = row;
    if (col > maxCol) maxCol = col;
  }
  maxRow = Math.min(maxRow, PREVIEW_MAX_ROWS);
  maxCol = Math.min(maxCol, PREVIEW_MAX_COLS);

  if (maxRow === 0 && maxCol === 0) {
    return (
      <div className={styles.centered}>
        <Text color="muted">This spreadsheet is empty.</Text>
      </div>
    );
  }

  const cols = Array.from({ length: maxCol }, (_, i) => numToAlpha(i + 1));
  const rows = Array.from({ length: maxRow }, (_, i) => i + 1);

  return (
    <div className={styles.sheetWrapper}>
      <table className={styles.sheetTable} aria-label="Spreadsheet preview">
        <thead>
          <tr>
            <th className={styles.sheetRowHeader} aria-label="Row numbers" />
            {cols.map((col) => (
              <th key={col} className={styles.sheetColHeader}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((rowNum) => (
            <tr key={rowNum}>
              <th className={styles.sheetRowHeader} scope="row">{rowNum}</th>
              {cols.map((col) => {
                const cellId = `${col}${rowNum}`;
                const cell = cellMap.get(cellId);
                const displayValue = cell?.value ?? cell?.raw ?? '';
                // Cell background must be applied inline and must not be overridden
                // by any dark-theme class on the modal wrapper.
                const cellBg = cell?.cellStyle?.backgroundColor;
                const cellColor = cell?.cellStyle?.color;
                const cellStyle: React.CSSProperties = {};
                if (cellBg) cellStyle.backgroundColor = cellBg;
                if (cellColor) cellStyle.color = cellColor;
                if (cell?.cellStyle?.fontWeight === 'bold') cellStyle.fontWeight = 700;
                if (cell?.cellStyle?.fontStyle === 'italic') cellStyle.fontStyle = 'italic';
                if (cell?.cellStyle?.textAlign) cellStyle.textAlign = cell.cellStyle.textAlign;
                return (
                  <td key={cellId} className={styles.sheetCell} style={cellStyle} title={displayValue}>
                    {displayValue}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A presentation, every slide drawn small, in order. */
export function SlideView({ presentation }: { presentation: SlidePresentation | null }) {
  const slides = presentation?.slides ?? [];
  if (slides.length === 0) {
    return (
      <div className={styles.centered}>
        <Text color="muted">This presentation has no slides.</Text>
      </div>
    );
  }

  return (
    <div className={styles.slidesTrack}>
      {slides.map((s, i) => (
        <div key={s.id} className={styles.slidePreviewItem}>
          <span className={styles.slideNumber}>{i + 1}</span>
          <div className={styles.slideThumbnailWrapper} style={slideBackgroundStyle(s.background)}>
            {s.elements.map((el) => {
              if (el.type === 'text') {
                const textEl = el as TextElement;
                return (
                  <div
                    key={el.id}
                    style={{
                      position: 'absolute',
                      left: `${el.x}%`,
                      top: `${el.y}%`,
                      width: `${el.w}%`,
                      height: `${el.h}%`,
                      // In proportion to the slide, whatever size it is drawn at: the editor lays a
                      // slide out 1280px wide with text at fontSize × 0.75px, and `cqw` is a
                      // percentage of this slide's own width (`container-type` in the CSS).
                      fontSize: `calc(${textEl.style.fontSize * 0.75} / 1280 * 100cqw)`,
                      fontWeight: textEl.style.bold ? 700 : 400,
                      fontStyle: textEl.style.italic ? 'italic' : 'normal',
                      color: textEl.style.color,
                      textAlign: textEl.style.align,
                      overflow: 'hidden',
                      lineHeight: 1.2,
                      fontFamily: textEl.style.fontFamily || undefined,
                    }}
                  >
                    {textEl.content}
                  </div>
                );
              }
              if (el.type === 'shape') {
                const shapeEl = el as ShapeElement;
                return (
                  <div
                    key={el.id}
                    style={{
                      position: 'absolute',
                      left: `${el.x}%`,
                      top: `${el.y}%`,
                      width: `${el.w}%`,
                      height: `${el.h}%`,
                    }}
                  >
                    <ShapeRenderer el={shapeEl} />
                  </div>
                );
              }
              return null;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A note's Markdown body, as the Notes app draws it. */
export function NoteView({ content }: { content: string }) {
  return <NoteBlocks content={content} className={styles.noteContent} />;
}

/** A diagram body (`DiagramDocument` JSON): its first page. */
export function DiagramView({ content }: { content: string }) {
  let doc: DiagramDocument | null = null;
  try {
    doc = JSON.parse(content) as DiagramDocument;
  } catch {
    return (
      <div className={styles.centered}>
        <Text color="muted">Could not parse diagram content.</Text>
      </div>
    );
  }

  const page = doc?.pages?.[0];
  if (!page || (page.shapes.length === 0 && page.connectors.length === 0)) {
    return (
      <div className={styles.centered}>
        <Text color="muted">This diagram is empty.</Text>
      </div>
    );
  }

  return (
    <div className={styles.canvasWrapper}>
      <div className={styles.canvasFrame}>
        <EmbeddedDiagramView page={page} width="100%" height="100%" bgColor={page.background || '#ffffff'} />
      </div>
    </div>
  );
}

/** A drawing body (`DrawingDocument` JSON), rendered to SVG and shown as an image. */
export function DrawingView({ content }: { content: string }) {
  const doc = parseDrawing(content);
  if (!doc) {
    return (
      <div className={styles.centered}>
        <Text color="muted">Could not parse drawing content.</Text>
      </div>
    );
  }

  if (drawingIsEmpty(doc)) {
    return (
      <div className={styles.centered}>
        <Text color="muted">This drawing is empty.</Text>
      </div>
    );
  }

  // The same renderer the editor exports with, so the preview and the file
  // agree. `<img>` rather than inline markup: the SVG carries layer names and
  // text straight from the document, and injecting that into the page would
  // make a drawing's own content a script vector.
  const svg = drawingToSvg(doc);
  const src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

  return (
    <div className={styles.canvasWrapper}>
      <div className={styles.canvasFrame}>
        <img
          src={src}
          alt={doc.metadata.title}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>
    </div>
  );
}

// ── Utility: column alpha to 0-based index ────────────────────────────────────

function alphaToColIndex(alpha: string): number {
  let result = 0;
  for (let i = 0; i < alpha.length; i++) {
    result = result * 26 + (alpha.charCodeAt(i) - 64);
  }
  return result;
}
