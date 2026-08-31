/**
 * The vocabulary `write.ts` and `read.ts` share: one spelling per concept, and
 * the tables that turn the sheets editor's model into SpreadsheetML and back.
 *
 * ## Why this exists
 *
 * A spreadsheet is stored as an `.xlsx` (issue #127), but what the editor could
 * *write* was `{v, t}` per cell — no styles, no widths, no merges, no
 * conditional formats — so every save carried a second, complete copy of the
 * model in a `neutrino/model.json` part and the workbook beside it was
 * decorative. That part is what `ooxmlContainer.ts` calls a stopgap: a
 * spreadsheet edited in Excel comes back without it and is then read from a
 * workbook that never held the real thing.
 *
 * Docs closed this by writing real OOXML (`ooxml/docx/`). This is the same move
 * for sheets. The worksheet parts are the spreadsheet now: values, formulas,
 * number formats, fonts, fills, borders, alignment, merges, column widths, row
 * heights, tab colours, conditional formats and tables are all written as the
 * SpreadsheetML element that means them, and read back from it.
 *
 * ## The extras part
 *
 * What OOXML genuinely has no way to say goes in `customXml/item1.xml`, the
 * same mechanism and the same rules as `docx/mapping.ts`: it holds *only* the
 * leftovers, addressed by index, so a workbook edited elsewhere loses the
 * leftovers and keeps the spreadsheet. It is not the old model part under a new
 * name — drop it and every cell, style and rule below still reads.
 *
 * Three things live there, and each is a bounded gap rather than a shrug:
 *
 * - **Charts.** Neutrino has twenty chart types, annotations and trendlines;
 *   OOXML chart parts for those are a project of their own, and no chart is
 *   written today. This is the one thing still carried whole.
 * - **The conditional-format kinds OOXML has no operator for** — progress bars,
 *   status indicators, heat-map presets, theme tokens and variable references.
 *   An approximation *is* written for each (a data bar, a colour scale, a plain
 *   `cellIs`), so Excel shows something truthful; the extras entry is what
 *   restores the exact rule here.
 * - **Small attributes with no home**: a table's Neutrino style id (the table
 *   itself is a real OOXML table), `clip` as distinct from `overflow` (OOXML
 *   has `wrapText` and nothing else), and the CF variable definitions a
 *   `variable` rule refers to.
 *
 * ## Canonicalisation
 *
 * Colours normalise to `#rrggbb` and font sizes to points, because OOXML has
 * one spelling of each (`rgb="FFRRGGBB"`, `<sz val="11"/>`). `rgb(0,0,0)` and
 * `11px` render identically to what they become, and the normalisation happens
 * on the way in, so round-trip equality holds for anything saved once.
 */

import type {
  CFRule, CFStyle, CellStyle, SavedCell, SheetData, SheetFile,
} from '@/app/(apps)/sheets/editor/types';
import type { ChartDef } from '@/app/(apps)/sheets/editor/charts/chartTypes';

export type { CFRule, CFStyle, CellStyle, SavedCell, SheetData, SheetFile };

// ── Namespaces and parts ──────────────────────────────────────────────────────

export const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

export const EXTRAS_PART = 'customXml/item1.xml';
export const EXTRAS_PROPS_PART = 'customXml/itemProps1.xml';
export const EXTRAS_NAMESPACE = 'https://neutrino.app/ns/sheet-extras';

// ── The extras ────────────────────────────────────────────────────────────────

/**
 * Per-sheet data with no SpreadsheetML home, addressed by sheet index and then
 * by the item's index within the sheet.
 *
 * Indices rather than ids, for the reason `docx/mapping.ts` gives: an id would
 * have to be written into the workbook to be found again, and every mechanism
 * for that is one Excel may renumber. An index degrades predictably — edit in
 * Excel and the entries stop matching, so they are dropped and the workbook,
 * which is all real OOXML, still reads.
 */
export interface SheetExtras {
  sheets?: Record<number, SheetExtra>;
}

export interface SheetExtra {
  /** The whole chart model: OOXML chart parts are not written (see the header). */
  charts?: ChartDef[];
  /** Named reusable rule definitions a `variable` rule refers to. */
  cfVariables?: SheetData['cfVariables'];
  /**
   * Conditional-format rules whose kind OOXML cannot express, by their index in
   * the sheet's rule order. An approximation of each is written to the
   * worksheet, and the entry here replaces it on the way back.
   */
  conditionalFormats?: Record<number, CFRule>;
  /** A table's Neutrino style id, by the table's index in the sheet. */
  tableStyles?: Record<number, string>;
  /** Cells whose wrap mode is `clip`; OOXML has `wrapText` and no third state. */
  clipped?: string[];
}

// ── XML ───────────────────────────────────────────────────────────────────────

/** Escape text for an element body or a double-quoted attribute. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Strip the characters XML 1.0 cannot carry at all.
 *
 * A cell can hold anything the user pasted, control characters included, and a
 * workbook containing one is rejected outright rather than degraded — so a
 * stray `\x00` from a bad paste would cost the whole spreadsheet.
 */
export function xmlSafe(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

// ── Cell addressing ───────────────────────────────────────────────────────────

export const CELL_ID = /^([A-Z]+)(\d+)$/;

export function columnToNumber(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
}

export function numberToColumn(n: number): string {
  let out = '';
  while (n > 0) {
    n--;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

/** `{ col, row }` for a cell id, both 1-based; `null` if it is not one. */
export function parseCellId(id: string): { col: number; row: number } | null {
  const m = CELL_ID.exec(id);
  return m ? { col: columnToNumber(m[1]), row: Number(m[2]) } : null;
}

// ── Units ─────────────────────────────────────────────────────────────────────

/**
 * Column widths are in "characters of the maximum digit width" in OOXML and in
 * CSS pixels in the editor. Seven pixels per digit plus five of padding is the
 * conversion Excel documents and SheetJS uses, so a width written here comes
 * back the same number of pixels.
 */
export const pxToCharWidth = (px: number): number => (px - 5) / 7;
export const charWidthToPx = (chars: number): number => Math.round(chars * 7 + 5);

/** Row heights are points in OOXML and CSS pixels in the editor: 1px = 0.75pt. */
export const pxToPoints = (px: number): number => px * 0.75;
export const pointsToPx = (pt: number): number => Math.round(pt / 0.75);

// ── Colours ───────────────────────────────────────────────────────────────────

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB_COLOR = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,[^)]*)?\)$/i;

/** A CSS colour as `#rrggbb`, or `null` for one this cannot read. */
export function normalizeColor(value: string | undefined | null): string | null {
  if (!value) return null;
  const raw = value.trim();
  const hex = HEX_COLOR.exec(raw);
  if (hex) {
    const body = hex[1];
    const full = body.length === 3 ? body.split('').map((c) => c + c).join('') : body;
    return `#${full.toLowerCase()}`;
  }
  const rgb = RGB_COLOR.exec(raw);
  if (rgb) {
    const part = (n: string) => Math.min(255, Number(n)).toString(16).padStart(2, '0');
    return `#${part(rgb[1])}${part(rgb[2])}${part(rgb[3])}`.toLowerCase();
  }
  return null;
}

/** `#rrggbb` as the `FFRRGGBB` an OOXML `rgb` attribute wants. */
export function toArgb(value: string | undefined | null): string | null {
  const hex = normalizeColor(value);
  return hex ? `FF${hex.slice(1).toUpperCase()}` : null;
}

/** An OOXML `rgb` attribute as `#rrggbb`, dropping the alpha byte. */
export function fromArgb(value: string | null | undefined): string | null {
  if (!value) return null;
  const hex = value.length === 8 ? value.slice(2) : value;
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}

// ── Number formats ────────────────────────────────────────────────────────────

/**
 * The format code for a structured `numberFormat` + `decimalPlaces`.
 *
 * These are the codes `formatCellValue` renders: grouped numbers, US dollars,
 * percentages, and the US date and time shapes `toLocaleDateString` produces.
 * They are written out so Excel formats the cell the same way, and recognised
 * again on the way back by `structuredFormat`.
 */
export function formatCodeFor(style: CellStyle): string | null {
  if (style.customFormat) return style.customFormat;
  const kind = style.numberFormat;
  if (!kind) return null;
  const decimals = style.decimalPlaces ?? (kind === 'currency' ? 2 : 0);
  const frac = decimals > 0 ? `.${'0'.repeat(decimals)}` : '';
  switch (kind) {
    case 'number': return `#,##0${frac}`;
    case 'currency': return `$#,##0${frac}`;
    case 'percent': return `0${frac}%`;
    case 'date': return 'm/d/yyyy';
    case 'time': return 'h:mm:ss AM/PM';
    case 'datetime': return 'm/d/yyyy h:mm:ss AM/PM';
  }
}

/**
 * A format code back as `numberFormat` + `decimalPlaces`, when it is one of
 * ours; `null` for anything else, which becomes a `customFormat` instead.
 *
 * Exact matching, deliberately: a code this half-recognises would come back as
 * a structured format that renders differently from the file, which is worse
 * than carrying it through verbatim as a custom one.
 */
export function structuredFormat(code: string): Pick<CellStyle, 'numberFormat' | 'decimalPlaces'> | null {
  if (code === 'm/d/yyyy') return { numberFormat: 'date' };
  if (code === 'h:mm:ss AM/PM') return { numberFormat: 'time' };
  if (code === 'm/d/yyyy h:mm:ss AM/PM') return { numberFormat: 'datetime' };
  const decimalsOf = (frac: string | undefined) => (frac ? frac.length - 1 : 0);
  let m = /^#,##0(\.0+)?$/.exec(code);
  if (m) return { numberFormat: 'number', decimalPlaces: decimalsOf(m[1]) };
  m = /^\$#,##0(\.0+)?$/.exec(code);
  if (m) return { numberFormat: 'currency', decimalPlaces: decimalsOf(m[1]) };
  m = /^0(\.0+)?%$/.exec(code);
  if (m) return { numberFormat: 'percent', decimalPlaces: decimalsOf(m[1]) };
  return null;
}

/** Built-in format ids worth reusing, so a plain file does not carry a `numFmts`. */
export const BUILTIN_FORMATS: Record<number, string> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  14: 'm/d/yyyy',
  22: 'm/d/yy h:mm',
};

/** Where custom format codes start; below this the ids are Excel's own. */
export const FIRST_CUSTOM_FORMAT_ID = 164;

// ── Alignment, borders, wrapping ──────────────────────────────────────────────

export const H_ALIGN: Record<string, string> = { left: 'left', center: 'center', right: 'right' };
export const H_ALIGN_BACK: Record<string, CellStyle['textAlign']> = {
  left: 'left', center: 'center', right: 'right',
};

export const V_ALIGN: Record<string, string> = { top: 'top', middle: 'center', bottom: 'bottom' };
export const V_ALIGN_BACK: Record<string, CellStyle['verticalAlign']> = {
  top: 'top', center: 'middle', bottom: 'bottom',
};

export type BorderWeight = 'none' | 'thin' | 'medium' | 'thick';
export const BORDER_SIDES = ['borderLeft', 'borderRight', 'borderTop', 'borderBottom'] as const;
export type BorderSide = (typeof BORDER_SIDES)[number];

/** OOXML's border style names happen to match the editor's for all three weights. */
export function borderStyleName(weight: BorderWeight | undefined): string | null {
  return weight && weight !== 'none' ? weight : null;
}

export function borderWeight(name: string | null | undefined): BorderWeight | null {
  return name === 'thin' || name === 'medium' || name === 'thick' ? name : null;
}

// ── Conditional formats ───────────────────────────────────────────────────────

/** `cellIs` operators, both ways. */
export const CF_OPERATOR: Record<string, string> = {
  greaterThan: 'greaterThan',
  lessThan: 'lessThan',
  equalTo: 'equal',
  notEqualTo: 'notEqual',
  between: 'between',
};
export const CF_OPERATOR_BACK: Record<string, string> = {
  greaterThan: 'greaterThan',
  lessThan: 'lessThan',
  equal: 'equalTo',
  notEqual: 'notEqualTo',
  between: 'between',
};

/** `timePeriod` values for the date conditions that have one. */
export const CF_TIME_PERIOD: Record<string, string> = {
  dateIsToday: 'today',
  dateIsTomorrow: 'tomorrow',
  dateIsNextWeek: 'nextWeek',
  dateIsThisMonth: 'thisMonth',
};
export const CF_TIME_PERIOD_BACK: Record<string, string> = {
  today: 'dateIsToday',
  tomorrow: 'dateIsTomorrow',
  nextWeek: 'dateIsNextWeek',
  thisMonth: 'dateIsThisMonth',
};

/** The three icon sets the editor offers, as OOXML's names for them. */
export const CF_ICON_SET: Record<string, string> = {
  trafficLights: '3TrafficLights1',
  arrows: '3Arrows',
  ratings: '3Stars',
};
export const CF_ICON_SET_BACK: Record<string, string> = {
  '3TrafficLights1': 'trafficLights',
  '3Arrows': 'arrows',
  '3Stars': 'ratings',
};

/** The colours a `themeColor` rule's token stands for. */
export const CF_THEME_COLORS: Record<string, CFStyle> = {
  success: { backgroundColor: '#d7f5dd', color: '#0b6b2e' },
  warning: { backgroundColor: '#fff4cc', color: '#7a5300' },
  danger: { backgroundColor: '#ffdcdc', color: '#8a1414' },
  info: { backgroundColor: '#dbe9ff', color: '#123a7a' },
};

/** The colour ramps a `heatMap` preset stands for, low → mid → high. */
export const CF_HEAT_MAP_PRESETS: Record<string, [string, string, string]> = {
  financial: ['#f8696b', '#ffeb84', '#63be7b'],
  performance: ['#5a8ac6', '#fcfcff', '#f8696b'],
  temperature: ['#4a7ebb', '#ffffff', '#e0574a'],
};

const NATIVE_CF_KINDS = [
  'singleColor', 'colorScale', 'dataBar', 'iconSet',
  'duplicates', 'uniques', 'topBottom', 'average', 'formula',
];

/**
 * Whether a rule needs an entry in the extras part to come back exactly.
 *
 * True for a kind OOXML has no operator for, and for the one *condition* that
 * has none either: `dateIsPastDue` is "before today", which is written as the
 * comparison it is and would otherwise read back as an ordinary `lessThan`.
 * Everything here still gets an approximation written to the worksheet, so
 * Excel shows the cell as flagged — see `write.ts`.
 */
export function needsCfExtra(spec: { kind: string; condition?: string }): boolean {
  if (!NATIVE_CF_KINDS.includes(spec.kind)) return true;
  return spec.kind === 'singleColor' && spec.condition === 'dateIsPastDue';
}
