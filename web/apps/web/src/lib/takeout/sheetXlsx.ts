/**
 * Turning an exported spreadsheet into the sheets editor's stored JSON.
 *
 * The editor persists a workbook as a `SheetFile` — one entry per tab, each a
 * flat `{ "A1": { id, raw, value, … } }` map plus its column widths, row
 * heights and merges (`sheets/editor/hooks/usePersistence.ts`). That is what an
 * import has to produce; the conversion is done here rather than by reaching
 * into the editor, for the same reason `docHtml.ts` converts a document by
 * hand: importing from the editor would pull the whole of it — grid, formula
 * engine, charts — into the import page's bundle.
 *
 * The bytes are read with SheetJS, which the editor already depends on for its
 * own .xlsx import and export, loaded dynamically so it lands in a chunk of its
 * own rather than in the page.
 *
 * ── What a cell becomes ──────────────────────────────────────────────────────
 *
 * `raw` is what the editor evaluates and what the user sees in the formula bar,
 * so it holds the *unformatted* value — `0.15`, not `15%` — and the exported
 * number format is carried separately as `cellStyle.customFormat`, which the
 * editor's `applyCustomFormat` reads in the same Excel notation the file uses
 * (`0.00%`, `$#,##0.00`, `yyyy-mm-dd`). Keeping the two apart is what lets a
 * percentage still be a number you can sum.
 *
 * A date is that same arrangement, not a special case: the file stores one as
 * a serial number with a date format, and so does the import. The editor reads
 * a numeric value under a date format as a serial and renders it in UTC
 * (`parseCellDateValue`), which is the reason not to helpfully turn it into a
 * date string on the way in — formatting a date in the browser's timezone can
 * move it a day, and every such import would be wrong west of Greenwich.
 *
 * `value` is the display value from the export. The editor recomputes it on
 * load, so it matters mainly for the search index, which is written from the
 * imported JSON before anyone opens the file.
 */

import { CELL_H, CELL_W, MAX_COLS, MAX_ROWS } from '@/app/(apps)/sheets/editor/constants';
import type { CellStyle, SavedCell, SheetData, SheetFile } from '@/app/(apps)/sheets/editor/types';
import { logStep, logWarn } from './log';

type XlsxModule = typeof import('xlsx');
type Worksheet = import('xlsx').WorkSheet;
type Workbook = import('xlsx').WorkBook;
type XlsxCell = import('xlsx').CellObject;

export interface SheetConversionOptions {
  /**
   * Carry formulas across as formulas. When false, only the values Google
   * computed come over — see `DEFAULT_SHEET_IMPORT_OPTIONS` for the trade-off.
   */
  importFormulas: boolean;
}

/**
 * The biggest merge worth expanding. A merge is stored per covered cell, so a
 * file that merges an entire column — which Excel allows and some exports do —
 * would otherwise turn one range into a million cell records.
 */
const MAX_MERGE_CELLS = 10_000;

/** SheetJS's name for "no number format", which is not worth storing. */
const GENERAL_FORMAT = 'General';

// ── Cells ─────────────────────────────────────────────────────────────────────

/** The value to store in `raw`: what the user would have typed. */
function rawValueOf(cell: XlsxCell): string {
  switch (cell.t) {
    case 'n':
      return String(cell.v);
    case 'b':
      return cell.v ? 'TRUE' : 'FALSE';
    // Dates arrive as serial numbers (see `READ_OPTIONS`); a `Date` here means
    // the parser made one anyway, and its own formatting is then the only
    // reading of it that survives.
    case 'd':
      return cell.w ?? (cell.v instanceof Date ? cell.v.toISOString() : String(cell.v));
    // An error cell (`#REF!`) has a numeric code as its value and the error
    // text as its display.
    case 'e':
      return cell.w ?? String(cell.v);
    default:
      return cell.v == null ? '' : String(cell.v);
  }
}

/** The exported number format, in the notation `applyCustomFormat` reads. */
function styleOf(cell: XlsxCell): CellStyle | undefined {
  // A cell the parser turned into a `Date` carries its formatting in the value
  // already, and a date format over a formatted string reads as a number and
  // is dropped.
  if (cell.t === 'd') return undefined;
  const format = cell.z;
  if (typeof format !== 'string' || !format || format === GENERAL_FORMAT) return undefined;
  return { customFormat: format };
}

function convertCell(id: string, cell: XlsxCell, options: SheetConversionOptions): SavedCell | null {
  const display = cell.w ?? (cell.v == null ? '' : String(cell.v));
  const raw = options.importFormulas && cell.f ? `=${cell.f}` : rawValueOf(cell);
  if (raw === '' && display === '') return null;
  const cellStyle = styleOf(cell);
  return { id, raw, value: display, ...(cellStyle ? { cellStyle } : {}) };
}

// ── Sizing ────────────────────────────────────────────────────────────────────

/**
 * A column width in pixels. Files record either pixels outright or a count of
 * "0" characters, which SheetJS converts with the same 7-pixels-per-digit
 * assumption used here.
 */
function columnWidthPx(col: { wpx?: number; wch?: number } | undefined): number | undefined {
  if (!col) return undefined;
  if (typeof col.wpx === 'number' && col.wpx > 0) return Math.round(col.wpx);
  if (typeof col.wch === 'number' && col.wch > 0) return Math.round(col.wch * 7 + 5);
  return undefined;
}

/** A row height in pixels; files record either pixels or points. */
function rowHeightPx(row: { hpx?: number; hpt?: number } | undefined): number | undefined {
  if (!row) return undefined;
  if (typeof row.hpx === 'number' && row.hpx > 0) return Math.round(row.hpx);
  if (typeof row.hpt === 'number' && row.hpt > 0) return Math.round((row.hpt * 4) / 3);
  return undefined;
}

// ── Worksheets ────────────────────────────────────────────────────────────────

function convertWorksheet(
  name: string,
  ws: Worksheet,
  xlsx: XlsxModule,
  options: SheetConversionOptions,
): SheetData {
  const cells: Record<string, SavedCell> = {};
  /** Cells outside the grid the editor can address. */
  let outOfRange = 0;

  // Walked by address rather than over the declared range: a sheet whose
  // `!ref` claims a million rows costs nothing here if only a hundred of them
  // hold anything, which is the common shape of an exported sheet.
  for (const key of Object.keys(ws)) {
    if (key.startsWith('!')) continue;
    const cell = ws[key] as XlsxCell;
    if (!cell || (cell.v == null && !cell.f)) continue;
    const { r, c } = xlsx.utils.decode_cell(key);
    if (r < 0 || c < 0 || r >= MAX_ROWS || c >= MAX_COLS) {
      outOfRange++;
      continue;
    }
    const converted = convertCell(key, cell, options);
    if (converted) cells[key] = converted;
  }

  // Merges: the top-left cell carries the span, every cell it covers points
  // back at it — the shape the editor's own merge action writes.
  let skippedMerges = 0;
  for (const merge of ws['!merges'] ?? []) {
    const rows = merge.e.r - merge.s.r + 1;
    const cols = merge.e.c - merge.s.c + 1;
    if (rows < 1 || cols < 1 || (rows === 1 && cols === 1)) continue;
    if (rows * cols > MAX_MERGE_CELLS || merge.e.r >= MAX_ROWS || merge.e.c >= MAX_COLS) {
      skippedMerges++;
      continue;
    }
    const anchorId = xlsx.utils.encode_cell(merge.s);
    cells[anchorId] = { ...(cells[anchorId] ?? { id: anchorId }), colSpan: cols, rowSpan: rows };
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        const id = xlsx.utils.encode_cell({ r, c });
        if (id === anchorId) continue;
        cells[id] = { ...(cells[id] ?? { id }), mergeAnchor: anchorId };
      }
    }
  }
  if (skippedMerges > 0) {
    logWarn('sheets', `${name}: ${skippedMerges} merged range(s) too large to import`, {
      limit: MAX_MERGE_CELLS,
    });
  }

  // Widths and heights are keyed by 0-based index, and only the ones the file
  // actually declares are stored — writing a width for every column would
  // bloat the file to say "unchanged".
  const colWidths: Record<string, number> = {};
  (ws['!cols'] ?? []).forEach((col, index) => {
    const width = columnWidthPx(col);
    if (width !== undefined && width !== CELL_W && index < MAX_COLS) colWidths[String(index)] = width;
  });
  const rowHeights: Record<string, number> = {};
  (ws['!rows'] ?? []).forEach((row, index) => {
    const height = rowHeightPx(row);
    if (height !== undefined && height !== CELL_H && index < MAX_ROWS) rowHeights[String(index)] = height;
  });

  if (outOfRange > 0) {
    logWarn('sheets', `${name}: ${outOfRange} cell(s) beyond the editor's grid were dropped`, {
      maxRows: MAX_ROWS,
      maxCols: MAX_COLS,
    });
  }

  return {
    name,
    cells,
    ...(Object.keys(colWidths).length > 0 ? { colWidths } : {}),
    ...(Object.keys(rowHeights).length > 0 ? { rowHeights } : {}),
  };
}

function convertWorkbook(wb: Workbook, xlsx: XlsxModule, options: SheetConversionOptions): SheetFile {
  const sheets = wb.SheetNames.map((name, index) => {
    const ws = wb.Sheets[name];
    // A tab with no worksheet behind it (a chart sheet, say) still has to
    // exist, or every tab after it shifts left.
    if (!ws) return { name: name || `Sheet ${index + 1}`, cells: {} } as SheetData;
    return convertWorksheet(name || `Sheet ${index + 1}`, ws, xlsx, options);
  });
  // The editor treats a file with no tabs as an empty workbook and leaves its
  // own default in place; one empty tab is what "this file was empty" means.
  return { sheets: sheets.length > 0 ? sheets : [{ name: 'Sheet 1', cells: {} }] };
}

// ── Entry points ──────────────────────────────────────────────────────────────

/**
 * `cellNF` so the number format survives — without it every cell arrives as
 * `General` and a date is an unexplained five-digit number.
 *
 * `cellStyles` is on for a narrower reason than its name suggests: it is the
 * pass that reads `<cols>` and row heights, so without it a sheet's column
 * widths are simply absent. The cell styling it also collects is not read
 * here (see `importSheets.ts` for why).
 *
 * `cellDates` is deliberately *off*: converting a serial to a `Date` is done
 * in the browser's timezone and can land a day out (see the header).
 */
const READ_OPTIONS = { cellNF: true, cellStyles: true } as const;

/**
 * Convert exported `.csv`/`.tsv` text into the editor's stored JSON, as a
 * single tab named after the file.
 *
 * The separator is passed rather than sniffed: SheetJS guesses well on ordinary
 * data but a CSV whose first row happens to hold tabs, or a TSV holding commas,
 * would be split on the wrong character, and the file's extension is a better
 * answer than a guess.
 */
export async function delimitedToSheetFile(
  text: string,
  { name, separator }: { name: string; separator: ',' | '\t' },
  options: SheetConversionOptions,
): Promise<SheetFile> {
  const xlsx = await import('xlsx');
  const wb = xlsx.read(text, { type: 'string', FS: separator, ...READ_OPTIONS });
  const file = convertWorkbook(wb, xlsx, options);
  // SheetJS names the one sheet it makes `Sheet1`; the file is the workbook
  // here, so its name is the better one.
  if (file.sheets.length === 1) file.sheets[0].name = name || file.sheets[0].name;
  logStep('sheets', `converted ${separator === ',' ? 'a CSV' : 'a TSV'}`, {
    name,
    cells: Object.keys(file.sheets[0]?.cells ?? {}).length,
  });
  return file;
}

// ── The stored file ──────────────────────────────────────────────────────────

/**
 * A converted spreadsheet as the `.xlsx` the editor stores.
 *
 * Only `.csv` and `.tsv` reach here. A `.xlsx` export is stored as itself —
 * see `importSheets.ts` — because a spreadsheet *is* an `.xlsx` and
 * `ooxml/xlsx/read.ts` opens the exported one directly. Converting it would be
 * the round trip docs stopped doing.
 */
export async function sheetFileToXlsx(file: SheetFile): Promise<Uint8Array> {
  const { writeXlsx } = await import('@/lib/ooxml/xlsx/write');
  return writeXlsx(file);
}
