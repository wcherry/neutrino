/**
 * What Sheets gives `useDocumentPreview`: the first sheet's top-left corner —
 * the part of a spreadsheet a printed first page would hold — as a signature
 * and as a picture.
 *
 * Drawn from the model onto a canvas rather than captured from the grid: the
 * grid is virtualised and shows wherever the user has scrolled to, so a capture
 * of it would make the preview of a budget a picture of row 4,000.
 *
 * The signature is built from the cells in that corner only, read the same way
 * from a freshly loaded `SheetFile` and from the editor's own serialisation, so
 * the two agree when nothing on page one changed.
 */
import type { CellStyle, SavedCell, SheetData } from './types';
import { CELL_H, CELL_W } from './constants';
import { alphaToNum, numToAlpha } from './utils';
import { toPreviewJpeg } from '@/lib/documentPreview';

/** Page one: about what fits on a printed Letter page at the default sizes. */
export const PREVIEW_ROWS = 20;
export const PREVIEW_COLS = 8;

const HEADER_W = 36;
const HEADER_H = 22;
const GRID_LINE = '#e2e2e2';
const HEADER_FILL = '#f3f3f3';
const HEADER_TEXT = '#666666';

function colWidth(sheet: SheetData | undefined, col: number): number {
  return sheet?.colWidths?.[String(col)] ?? CELL_W;
}

function rowHeight(sheet: SheetData | undefined, row: number): number {
  return sheet?.rowHeights?.[String(row)] ?? CELL_H;
}

/** The cells of page one, keyed by id. `A1` is (row 1, col 1). */
function pageOneCells(sheet: SheetData | undefined): SavedCell[] {
  if (!sheet) return [];
  const out: SavedCell[] = [];
  for (const [id, cell] of Object.entries(sheet.cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(id);
    if (!m) continue;
    if (alphaToNum(m[1]) <= PREVIEW_COLS && Number(m[2]) <= PREVIEW_ROWS) out.push(cell);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function displayText(cell: SavedCell): string {
  return cell.value ?? cell.raw ?? '';
}

export function sheetFirstPageSignature(sheet: SheetData | undefined): string {
  const cells = pageOneCells(sheet).map((c) => [
    c.id, displayText(c), c.cellStyle ?? null, c.colSpan ?? 1, c.rowSpan ?? 1, c.mergeAnchor ?? null,
  ]);
  const cols = Array.from({ length: PREVIEW_COLS }, (_, i) => colWidth(sheet, i));
  const rows = Array.from({ length: PREVIEW_ROWS }, (_, i) => rowHeight(sheet, i));
  return JSON.stringify([cells, cols, rows]);
}

function fontFor(style: CellStyle | undefined): string {
  const size = style?.fontSize ?? '13px';
  const px = /^\d+(\.\d+)?$/.test(size) ? `${size}px` : size;
  return [
    style?.fontStyle === 'italic' ? 'italic' : '',
    style?.fontWeight === 'bold' ? 'bold' : '',
    px,
    style?.fontFamily ?? 'Arial, sans-serif',
  ].filter(Boolean).join(' ');
}

export async function renderSheetFirstPage(sheet: SheetData | undefined): Promise<Blob | null> {
  const xs = [HEADER_W];
  for (let c = 0; c < PREVIEW_COLS; c++) xs.push(xs[c] + colWidth(sheet, c));
  const ys = [HEADER_H];
  for (let r = 0; r < PREVIEW_ROWS; r++) ys.push(ys[r] + rowHeight(sheet, r));
  const width = xs[PREVIEW_COLS];
  const height = ys[PREVIEW_ROWS];

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const cells = new Map(pageOneCells(sheet).map((c) => [c.id, c]));

  // Fills first, so a neighbour's fill never paints over text that overflows.
  for (const cell of cells.values()) {
    const fill = cell.cellStyle?.backgroundColor;
    if (!fill || cell.mergeAnchor) continue;
    const m = /^([A-Z]+)(\d+)$/.exec(cell.id)!;
    const c = alphaToNum(m[1]) - 1;
    const r = Number(m[2]) - 1;
    const c2 = Math.min(PREVIEW_COLS, c + (cell.colSpan ?? 1));
    const r2 = Math.min(PREVIEW_ROWS, r + (cell.rowSpan ?? 1));
    ctx.fillStyle = fill;
    ctx.fillRect(xs[c], ys[r], xs[c2] - xs[c], ys[r2] - ys[r]);
  }

  // Grid lines and headers.
  ctx.strokeStyle = GRID_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const x of xs) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, height); }
  for (const y of ys) { ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); }
  ctx.stroke();
  ctx.fillStyle = HEADER_FILL;
  ctx.fillRect(0, 0, width, HEADER_H);
  ctx.fillRect(0, 0, HEADER_W, height);
  ctx.fillStyle = HEADER_TEXT;
  ctx.font = '12px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let c = 0; c < PREVIEW_COLS; c++) ctx.fillText(numToAlpha(c + 1), (xs[c] + xs[c + 1]) / 2, HEADER_H / 2);
  for (let r = 0; r < PREVIEW_ROWS; r++) ctx.fillText(String(r + 1), HEADER_W / 2, (ys[r] + ys[r + 1]) / 2);

  // Text, clipped to the visible page.
  ctx.save();
  ctx.beginPath();
  ctx.rect(HEADER_W, HEADER_H, width - HEADER_W, height - HEADER_H);
  ctx.clip();
  for (const cell of cells.values()) {
    const text = displayText(cell);
    if (!text || cell.mergeAnchor) continue;
    const style = cell.cellStyle;
    const m = /^([A-Z]+)(\d+)$/.exec(cell.id)!;
    const c = alphaToNum(m[1]) - 1;
    const r = Number(m[2]) - 1;
    const c2 = Math.min(PREVIEW_COLS, c + (cell.colSpan ?? 1));
    const r2 = Math.min(PREVIEW_ROWS, r + (cell.rowSpan ?? 1));
    // A number reads right-aligned unless the cell says otherwise, as on screen.
    const align = style?.textAlign ?? (text.trim() !== '' && !Number.isNaN(Number(text)) ? 'right' : 'left');
    ctx.font = fontFor(style);
    ctx.fillStyle = style?.color ?? '#000000';
    ctx.textAlign = align;
    const x = align === 'left' ? xs[c] + 4 : align === 'right' ? xs[c2] - 4 : (xs[c] + xs[c2]) / 2;
    ctx.fillText(text, x, (ys[r] + ys[r2]) / 2);
  }
  ctx.restore();

  return toPreviewJpeg(canvas);
}
