/**
 * Finding Google Sheets spreadsheets inside a Takeout archive.
 *
 * A Google Sheet is a Drive file, so like a document it comes out under
 * `Takeout/Drive/` rather than in a product directory of its own; `drive.ts`
 * describes that layout and locates the directory, and this is the docs
 * finder's counterpart for the spreadsheet-shaped files in it.
 *
 * Three formats can be read here: `.xlsx` (the Takeout default, and the only
 * one that carries more than one tab), `.csv` and `.tsv`. `.ods` and the
 * ancient `.xls` are spreadsheets we cannot convert in the browser, so — like
 * the docs finder's `.pdf` — they are counted and reported rather than
 * silently missing, because a user who exported their Sheets as OpenDocument
 * would otherwise be told the archive holds no spreadsheets at all.
 *
 * A `.csv` in Drive is not necessarily an exported Google Sheet — it may be a
 * CSV the user uploaded, and Takeout emits a `.csv` per *tab* when Sheets is
 * exported in that format, so a workbook arrives as several files. Both come
 * across as one spreadsheet each, which is the honest reading of a lone `.csv`
 * and the reason `.xlsx` is worth recommending on the page.
 */

import type { TakeoutArchive, TakeoutEntry, TakeoutProductDir } from './archive';
import {
  baseName,
  countBy,
  findDriveDirectory,
  folderPath,
  jsonEntriesByPath,
  readDriveInfo,
  sidecarFor,
  stripExtension,
  type DriveFileInfo,
} from './drive';
import { logStep, logWarn } from './log';

/** How a spreadsheet's bytes have to be read to get at its cells. */
export type SheetFormat = 'xlsx' | 'csv' | 'tsv';

const FORMAT_BY_EXTENSION: Record<string, SheetFormat> = {
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  csv: 'csv',
  tsv: 'tsv',
  tab: 'tsv',
};

/**
 * Spreadsheet formats Takeout can produce that cannot be converted here,
 * mapped to what to call them when reporting.
 */
const UNCONVERTIBLE_BY_EXTENSION: Record<string, string> = {
  ods: 'OpenDocument spreadsheet',
  xls: 'Excel 97–2003',
};

export interface DriveSheetEntry {
  entry: TakeoutEntry;
  format: SheetFormat;
  /** Title taken from the filename; `readSheetInfo` may have a better one. */
  title: string;
  /** The folders this file sat in inside the export, outermost first. */
  path: string[];
  /** Google's metadata sidecar for this file, when the export includes them. */
  info?: TakeoutEntry;
}

export interface UnsupportedSheet {
  /** Path inside the Drive directory. */
  path: string;
  /** Human-readable format name, e.g. `OpenDocument spreadsheet`. */
  format: string;
}

export interface DriveSheetsSource {
  /** Directory the spreadsheets came from, for display. */
  directory: string;
  sheets: DriveSheetEntry[];
  unsupported: UnsupportedSheet[];
}

// ── Locating the spreadsheets ─────────────────────────────────────────────────

function collect(dir: TakeoutProductDir): DriveSheetsSource {
  const jsonByPath = jsonEntriesByPath(dir);

  const sheets: DriveSheetEntry[] = [];
  const unsupported: UnsupportedSheet[] = [];
  /** Extensions that were neither a spreadsheet nor a format we report on. */
  const ignored = new Map<string, number>();

  for (const entry of dir.entries) {
    const format = FORMAT_BY_EXTENSION[entry.ext];
    if (format) {
      sheets.push({
        entry,
        format,
        title: stripExtension(baseName(entry.path)),
        path: folderPath(entry.path),
        info: sidecarFor(entry.path, jsonByPath),
      });
      continue;
    }
    const unconvertible = UNCONVERTIBLE_BY_EXTENSION[entry.ext];
    if (unconvertible) unsupported.push({ path: entry.path, format: unconvertible });
    else ignored.set(entry.ext || '(no extension)', (ignored.get(entry.ext || '(no extension)') ?? 0) + 1);
  }

  // As in the docs finder, the ignored tally is the answer to "why didn't it
  // find my spreadsheets?" — it names the extensions that were passed over,
  // which is what an export made in the wrong format looks like from here.
  logStep('sheets', `scanned ${dir.name}`, {
    entries: dir.entries.length,
    spreadsheets: sheets.length,
    byFormat: countBy(sheets.map((s) => s.format)),
    withSidecar: sheets.filter((s) => s.info).length,
    unsupported: countBy(unsupported.map((u) => u.format)),
    ignored: Object.fromEntries(ignored),
  });

  return { directory: dir.name, sheets, unsupported };
}

/** Locate the spreadsheets in an archive, or `null` when it holds none. */
export function findDriveSheets(archive: TakeoutArchive): DriveSheetsSource | null {
  // `.xlsx` is the signal for a Drive directory Google localised the name of —
  // see `drive.ts` for why it can't be `.csv`.
  const dir = findDriveDirectory(archive, { scope: 'sheets', signalExt: 'xlsx' });
  if (!dir) return null;

  const source = collect(dir);
  // A Drive directory of nothing but documents and photos is not a Sheets
  // export, and saying so is the page's "no spreadsheets found" case.
  if (source.sheets.length === 0 && source.unsupported.length === 0) {
    logWarn('sheets', `${dir.name} holds no spreadsheets in any format`);
    return null;
  }
  return source;
}

// ── The metadata sidecar ──────────────────────────────────────────────────────

/** Read a spreadsheet's `-info.json`. See `readDriveInfo`. */
export function readSheetInfo(entry: TakeoutEntry | undefined): Promise<DriveFileInfo | null> {
  return readDriveInfo(entry, 'sheets');
}
