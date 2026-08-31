/**
 * An `.xlsx` → the sheets editor's model.
 *
 * The other half of `write.ts`, and the half that decides what "opening a
 * spreadsheet" means. It reads the parts directly: `workbook.xml` for the tabs
 * and their order, `styles.xml` for the format, font, fill, border and
 * alignment each cell points at, the worksheet parts for cells, formulas,
 * merges, column widths, row heights, conditional formats and table regions,
 * and the custom XML part for the handful of things OOXML cannot say.
 *
 * It replaces `xlsxBufferToSheets` in `usePersistence.ts`, which was twenty
 * lines of SheetJS at its defaults: it read `cell.w`, the *formatted* string,
 * so a percentage came back as the text `15%` and a date as a date string, and
 * it asked for neither `cellNF` nor `cellStyles`, so number formats, column
 * widths and row heights were simply absent along with formulas and merges.
 * That reader is why a spreadsheet had to carry a second copy of itself.
 *
 * Anything it does not recognise is left behind rather than guessed at, and
 * the cell keeps its value: a workbook written by another tool is a workbook
 * written by software that knows constructs this does not, and losing a column
 * of numbers is much worse than losing its shading.
 *
 * ## Known gaps
 *
 * Shared formulas (`<f t="shared">`) are read as their own text where the
 * master carries it and as empty where it does not — Excel writes the formula
 * once and leaves the rest of the group to derive it, and deriving it means
 * translating relative references. Cells in that position keep their cached
 * value, so the spreadsheet reads correctly and re-saves as literals.
 * Rich text runs inside a shared string collapse to their concatenated text.
 */

import type { JSZipObject } from 'jszip';
import { TABLE_STYLES } from '@/app/(apps)/sheets/editor/styles/tableStyles';
import {
  BUILTIN_FORMATS, CF_ICON_SET_BACK, CF_OPERATOR_BACK, CF_TIME_PERIOD_BACK,
  EXTRAS_PART, H_ALIGN_BACK, V_ALIGN_BACK,
  borderWeight, charWidthToPx, columnToNumber, fromArgb, numberToColumn,
  parseCellId, pointsToPx, structuredFormat,
  type CFRule, type CFStyle, type CellStyle, type SavedCell, type SheetData,
  type SheetExtra, type SheetExtras, type SheetFile,
} from './mapping';

// ── XML helpers ───────────────────────────────────────────────────────────────

/** Direct element children named `name`, whatever prefix was used. */
function kids(el: Element | null | undefined, name: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (const child of Array.from(el.children)) if (child.localName === name) out.push(child);
  return out;
}

function kid(el: Element | null | undefined, name: string): Element | null {
  return kids(el, name)[0] ?? null;
}

/** Every descendant named `name`, in document order. */
function all(root: Element | Document, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((el) => el.localName === name);
}

function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  const direct = el.getAttribute(name);
  if (direct !== null) return direct;
  // Namespaced attributes (`r:id`) come back only under their local name.
  for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value;
  return null;
}

function num(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('malformed XML');
  return doc;
}

// ── The package ───────────────────────────────────────────────────────────────

interface Package {
  zip: import('jszip');
  xml(path: string): Promise<Document | null>;
}

async function openPackage(bytes: Uint8Array): Promise<Package> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(bytes);
  return {
    zip,
    async xml(path: string) {
      const entry: JSZipObject | null = zip.file(path);
      if (!entry) return null;
      try {
        return parseXml(await entry.async('string'));
      } catch {
        return null;
      }
    },
  };
}

/** `Id → Target`, with targets resolved against the part's own directory. */
async function readRels(pkg: Package, partPath: string): Promise<Map<string, string>> {
  const dir = partPath.includes('/') ? partPath.slice(0, partPath.lastIndexOf('/')) : '';
  const relPath = `${dir ? `${dir}/` : ''}_rels/${partPath.slice(partPath.lastIndexOf('/') + 1)}.rels`;
  const doc = await pkg.xml(relPath);
  const out = new Map<string, string>();
  if (!doc) return out;
  for (const rel of all(doc, 'Relationship')) {
    const id = attr(rel, 'Id');
    const target = attr(rel, 'Target');
    if (id && target) out.set(id, resolveTarget(target, dir));
  }
  return out;
}

function resolveTarget(target: string, fromDir: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (fromDir ? `${fromDir}/${target}` : target).split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

// ── Styles ────────────────────────────────────────────────────────────────────

interface Styles {
  /** One entry per `cellXfs` index. */
  cells: (CellStyle | undefined)[];
  /** One entry per `dxfs` index, for conditional formats. */
  differentials: (CFStyle | undefined)[];
}

async function readStyles(pkg: Package): Promise<Styles> {
  const doc = await pkg.xml('xl/styles.xml');
  if (!doc) return { cells: [], differentials: [] };
  const root = doc.documentElement;

  const formats = new Map<number, string>();
  for (const [id, code] of Object.entries(BUILTIN_FORMATS)) formats.set(Number(id), code);
  for (const fmt of all(root, 'numFmt')) {
    const id = num(attr(fmt, 'numFmtId'));
    const code = attr(fmt, 'formatCode');
    if (id !== null && code !== null) formats.set(id, code);
  }

  const fonts = kids(kid(root, 'fonts'), 'font').map(fontStyle);
  const fills = kids(kid(root, 'fills'), 'fill').map(fillColor);
  const borders = kids(kid(root, 'borders'), 'border').map(borderStyle);

  const cells = kids(kid(root, 'cellXfs'), 'xf').map((xf) => {
    const style: CellStyle = {
      ...(fonts[num(attr(xf, 'fontId')) ?? 0] ?? {}),
      ...(borders[num(attr(xf, 'borderId')) ?? 0] ?? {}),
    };
    const fill = fills[num(attr(xf, 'fillId')) ?? 0];
    if (fill) style.backgroundColor = fill;

    const formatId = num(attr(xf, 'numFmtId'));
    const code = formatId !== null ? formats.get(formatId) : undefined;
    if (code && code !== 'General') {
      const structured = structuredFormat(code);
      if (structured) Object.assign(style, structured);
      else style.customFormat = code;
    }

    const alignment = kid(xf, 'alignment');
    if (alignment) {
      const h = attr(alignment, 'horizontal');
      const v = attr(alignment, 'vertical');
      if (h && H_ALIGN_BACK[h]) style.textAlign = H_ALIGN_BACK[h];
      if (v && V_ALIGN_BACK[v]) style.verticalAlign = V_ALIGN_BACK[v];
      if (attr(alignment, 'wrapText') === '1') style.wrapMode = 'wrap';
    }
    return Object.keys(style).length ? style : undefined;
  });

  const differentials = kids(kid(root, 'dxfs'), 'dxf').map((dxf) => {
    const format: CFStyle = {};
    const font = kid(dxf, 'font');
    if (font) {
      if (kid(font, 'b')) format.fontWeight = 'bold';
      if (kid(font, 'i')) format.fontStyle = 'italic';
      if (kid(font, 'u')) format.textDecoration = 'underline';
      const color = fromArgb(attr(kid(font, 'color'), 'rgb'));
      if (color) format.color = color;
    }
    const pattern = kid(kid(dxf, 'fill'), 'patternFill');
    const background = fromArgb(attr(kid(pattern, 'bgColor'), 'rgb'))
      ?? fromArgb(attr(kid(pattern, 'fgColor'), 'rgb'));
    if (background) format.backgroundColor = background;
    return Object.keys(format).length ? format : undefined;
  });

  return { cells, differentials };
}

function fontStyle(font: Element): CellStyle {
  const style: CellStyle = {};
  if (kid(font, 'b')) style.fontWeight = 'bold';
  if (kid(font, 'i')) style.fontStyle = 'italic';
  if (kid(font, 'strike')) style.textDecoration = 'line-through';
  const size = num(attr(kid(font, 'sz'), 'val'));
  // 11pt is the default every workbook opens at, so recording it would put a
  // font size on every cell of a file that never set one.
  if (size !== null && size !== 11) style.fontSize = `${size}pt`;
  const color = fromArgb(attr(kid(font, 'color'), 'rgb'));
  if (color) style.color = color;
  const name = attr(kid(font, 'name'), 'val');
  if (name && name !== 'Calibri') style.fontFamily = name;
  return style;
}

function fillColor(fill: Element): string | null {
  const pattern = kid(fill, 'patternFill');
  if (!pattern || attr(pattern, 'patternType') !== 'solid') return null;
  return fromArgb(attr(kid(pattern, 'fgColor'), 'rgb'));
}

function borderStyle(border: Element): CellStyle {
  const style: CellStyle = {};
  const sides = [
    ['left', 'borderLeft'], ['right', 'borderRight'],
    ['top', 'borderTop'], ['bottom', 'borderBottom'],
  ] as const;
  for (const [tag, key] of sides) {
    const weight = borderWeight(attr(kid(border, tag), 'style'));
    if (weight) style[key] = weight;
  }
  return style;
}

// ── Shared strings ────────────────────────────────────────────────────────────

async function readSharedStrings(pkg: Package): Promise<string[]> {
  const doc = await pkg.xml('xl/sharedStrings.xml');
  if (!doc) return [];
  return kids(doc.documentElement, 'si').map((si) =>
    // A rich-text string is a list of runs; their text concatenated is the
    // string, and the run formatting is not something a cell can hold here.
    all(si, 't').map((t) => t.textContent ?? '').join(''));
}

// ── Cells ─────────────────────────────────────────────────────────────────────

function readCell(c: Element, shared: string[], styles: Styles): SavedCell | null {
  const id = attr(c, 'r');
  if (!id || !parseCellId(id)) return null;
  const type = attr(c, 't') ?? 'n';
  const styleIndex = num(attr(c, 's')) ?? 0;
  const cellStyle = styles.cells[styleIndex];

  const formulaEl = kid(c, 'f');
  const valueEl = kid(c, 'v');
  const rawValue = valueEl?.textContent ?? '';

  let display: string;
  if (type === 'inlineStr') display = all(kid(c, 'is') ?? c, 't').map((t) => t.textContent ?? '').join('');
  else if (type === 's') display = shared[Number(rawValue)] ?? '';
  else if (type === 'b') display = rawValue === '1' ? 'TRUE' : 'FALSE';
  else display = rawValue;

  const formula = formulaEl?.textContent ?? '';
  const raw = formula ? `=${formula}` : display;
  if (raw === '' && display === '' && !cellStyle) return null;

  const cell: SavedCell = { id, raw, value: display };
  if (cellStyle) cell.cellStyle = { ...cellStyle };
  return cell;
}

// ── Conditional formats ───────────────────────────────────────────────────────

function readCfRule(rule: Element, range: string, index: number, sheet: number, styles: Styles): CFRule | null {
  const type = attr(rule, 'type');
  const dxfId = num(attr(rule, 'dxfId'));
  const format = dxfId !== null ? styles.differentials[dxfId] ?? {} : {};
  const formulas = kids(rule, 'formula').map((f) => f.textContent ?? '');
  const base = { id: `cf-${sheet}-${index}`, range, ...(attr(rule, 'stopIfTrue') === '1' ? { stopIfTrue: true } : {}) };
  const unquote = (v: string) => (/^".*"$/.test(v) ? v.slice(1, -1).replace(/""/g, '"') : v);

  switch (type) {
    case 'cellIs': {
      const condition = CF_OPERATOR_BACK[attr(rule, 'operator') ?? ''];
      if (!condition) return null;
      return {
        ...base,
        rule: {
          kind: 'singleColor',
          condition: condition as never,
          value: unquote(formulas[0] ?? ''),
          ...(formulas[1] !== undefined ? { value2: unquote(formulas[1]) } : {}),
          format,
        },
      };
    }
    case 'containsText':
      return {
        ...base,
        rule: { kind: 'singleColor', condition: 'containsText', value: attr(rule, 'text') ?? '', format },
      };
    case 'containsBlanks':
      return { ...base, rule: { kind: 'singleColor', condition: 'isEmpty', format } };
    case 'notContainsBlanks':
      return { ...base, rule: { kind: 'singleColor', condition: 'isNotEmpty', format } };
    case 'timePeriod': {
      const condition = CF_TIME_PERIOD_BACK[attr(rule, 'timePeriod') ?? ''];
      if (!condition) return null;
      return { ...base, rule: { kind: 'singleColor', condition: condition as never, format } };
    }
    case 'expression':
      return { ...base, rule: { kind: 'formula', formula: `=${formulas[0] ?? ''}`, format } };
    case 'duplicateValues':
      return { ...base, rule: { kind: 'duplicates', format } };
    case 'uniqueValues':
      return { ...base, rule: { kind: 'uniques', format } };
    case 'top10':
      return {
        ...base,
        rule: {
          kind: 'topBottom',
          direction: attr(rule, 'bottom') === '1' ? 'bottom' : 'top',
          type: attr(rule, 'percent') === '1' ? 'percent' : 'n',
          value: num(attr(rule, 'rank')) ?? 10,
          format,
        },
      };
    case 'aboveAverage':
      return {
        ...base,
        rule: { kind: 'average', direction: attr(rule, 'aboveAverage') === '0' ? 'below' : 'above', format },
      };
    case 'colorScale': {
      const colors = kids(kid(rule, 'colorScale'), 'color')
        .map((c) => fromArgb(attr(c, 'rgb')))
        .filter((c): c is string => Boolean(c));
      if (colors.length < 2) return null;
      return {
        ...base,
        rule: colors.length >= 3
          ? { kind: 'colorScale', minColor: colors[0], midColor: colors[1], maxColor: colors[2] }
          : { kind: 'colorScale', minColor: colors[0], maxColor: colors[1] },
      };
    }
    case 'dataBar': {
      const color = fromArgb(attr(kid(kid(rule, 'dataBar'), 'color'), 'rgb'));
      return { ...base, rule: { kind: 'dataBar', color: color ?? '#638ec6', gradient: true } };
    }
    case 'iconSet': {
      const set = CF_ICON_SET_BACK[attr(kid(rule, 'iconSet'), 'iconSet') ?? ''];
      return { ...base, rule: { kind: 'iconSet', iconSet: (set ?? 'trafficLights') as never } };
    }
    default:
      return null;
  }
}

// ── Tables ────────────────────────────────────────────────────────────────────

const DEFAULT_TABLE_STYLE = TABLE_STYLES[0]?.id ?? 'blank';

function tableRegion(ref: string, index: number, sheet: number, styleId: string | undefined) {
  const [from, to] = ref.split(':');
  const start = parseCellId(from ?? '');
  const end = parseCellId(to ?? from ?? '');
  if (!start || !end) return null;
  return {
    id: `table-${sheet}-${index}`,
    styleId: styleId ?? DEFAULT_TABLE_STYLE,
    minR: start.row,
    maxR: end.row,
    minC: start.col,
    maxC: end.col,
  };
}

// ── The extras part ───────────────────────────────────────────────────────────

async function readExtras(pkg: Package): Promise<SheetExtras> {
  const doc = await pkg.xml(EXTRAS_PART);
  if (!doc) return {};
  const payload = all(doc, 'payload')[0]?.textContent;
  if (!payload) return {};
  try {
    const parsed = JSON.parse(payload) as SheetExtras;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** `bytes` as the editor's `SheetFile`. */
export async function readXlsx(bytes: Uint8Array): Promise<SheetFile> {
  const pkg = await openPackage(bytes);
  const workbook = await pkg.xml('xl/workbook.xml');
  if (!workbook) throw new Error('not a workbook: xl/workbook.xml is missing');

  const rels = await readRels(pkg, 'xl/workbook.xml');
  const [styles, shared, extras] = await Promise.all([
    readStyles(pkg), readSharedStrings(pkg), readExtras(pkg),
  ]);

  const entries = all(workbook, 'sheet');
  const sheets: SheetData[] = [];
  for (const [index, entry] of entries.entries()) {
    const extra: SheetExtra = extras.sheets?.[index] ?? {};
    const path = rels.get(attr(entry, 'id') ?? '');
    const name = attr(entry, 'name') ?? `Sheet ${index + 1}`;
    const doc = path ? await pkg.xml(path) : null;
    if (!doc) {
      // A tab whose part is missing or unreadable — a chart sheet, say — still
      // has to exist, or every tab after it shifts left.
      sheets.push({ name, cells: {} });
      continue;
    }
    sheets.push(await readSheet(doc, path!, name, index, pkg, styles, shared, extra));
  }

  return { sheets: sheets.length > 0 ? sheets : [{ name: 'Sheet 1', cells: {} }] };
}

async function readSheet(
  doc: Document,
  path: string,
  name: string,
  index: number,
  pkg: Package,
  styles: Styles,
  shared: string[],
  extra: SheetExtra,
): Promise<SheetData> {
  const root = doc.documentElement;
  const sheet: SheetData = { name, cells: {} };

  const tabColor = fromArgb(attr(kid(kid(root, 'sheetPr'), 'tabColor'), 'rgb'));
  if (tabColor) sheet.color = tabColor;

  // ── Cells.
  const clipped = new Set(extra.clipped ?? []);
  for (const row of kids(kid(root, 'sheetData'), 'row')) {
    for (const c of kids(row, 'c')) {
      const cell = readCell(c, shared, styles);
      if (!cell) continue;
      // OOXML has `wrapText` and no third state, so `clip` comes back from the
      // extras entry; `overflow` is the absence of both.
      if (clipped.has(cell.id)) cell.cellStyle = { ...cell.cellStyle, wrapMode: 'clip' };
      sheet.cells[cell.id] = cell;
    }
  }

  // ── Column widths and row heights, both 0-based in the model.
  const colWidths: Record<string, number> = {};
  for (const col of kids(kid(root, 'cols'), 'col')) {
    const width = num(attr(col, 'width'));
    const min = num(attr(col, 'min'));
    const max = num(attr(col, 'max'));
    if (width === null || min === null) continue;
    // One `<col>` can size a span of columns; the model is one entry each.
    for (let i = min; i <= (max ?? min); i++) colWidths[String(i - 1)] = charWidthToPx(width);
  }
  if (Object.keys(colWidths).length) sheet.colWidths = colWidths;

  const rowHeights: Record<string, number> = {};
  for (const row of kids(kid(root, 'sheetData'), 'row')) {
    const r = num(attr(row, 'r'));
    const ht = num(attr(row, 'ht'));
    if (r !== null && ht !== null && attr(row, 'customHeight') === '1') {
      rowHeights[String(r - 1)] = pointsToPx(ht);
    }
  }
  if (Object.keys(rowHeights).length) sheet.rowHeights = rowHeights;

  // ── Merges, expanded back onto every covered cell.
  for (const merge of kids(kid(root, 'mergeCells'), 'mergeCell')) {
    const ref = attr(merge, 'ref');
    if (!ref) continue;
    const [from, to] = ref.split(':');
    const start = parseCellId(from ?? '');
    const end = parseCellId(to ?? '');
    if (!start || !end) continue;
    const anchor = from;
    const anchorCell = sheet.cells[anchor] ?? { id: anchor, raw: '', value: '' };
    anchorCell.colSpan = end.col - start.col + 1;
    anchorCell.rowSpan = end.row - start.row + 1;
    sheet.cells[anchor] = anchorCell;
    for (let c = start.col; c <= end.col; c++) {
      for (let r = start.row; r <= end.row; r++) {
        const id = `${numberToColumn(c)}${r}`;
        if (id === anchor) continue;
        const covered = sheet.cells[id] ?? { id, raw: '', value: '' };
        covered.mergeAnchor = anchor;
        sheet.cells[id] = covered;
      }
    }
  }

  // ── Conditional formats, then the extras overlay by rule index.
  const rules: CFRule[] = [];
  for (const block of kids(root, 'conditionalFormatting')) {
    const range = attr(block, 'sqref') ?? '';
    for (const rule of kids(block, 'cfRule')) {
      const parsed = readCfRule(rule, range, rules.length, index, styles);
      if (parsed) rules.push(parsed);
    }
  }
  for (const [at, rule] of Object.entries(extra.conditionalFormats ?? {})) {
    const i = Number(at);
    if (i >= 0 && i < rules.length) rules[i] = rule;
    else if (i === rules.length) rules.push(rule);
  }
  if (rules.length) sheet.conditionalFormats = rules;
  if (extra.cfVariables?.length) sheet.cfVariables = extra.cfVariables;

  // ── Tables.
  const partIds = kids(kid(root, 'tableParts'), 'tablePart')
    .map((part) => attr(part, 'id'))
    .filter((id): id is string => Boolean(id));
  if (partIds.length) {
    const sheetRels = await readRels(pkg, path);
    const regions: NonNullable<SheetData['tables']> = [];
    for (const [i, id] of partIds.entries()) {
      const target = sheetRels.get(id);
      const table = target ? await pkg.xml(target) : null;
      const ref = attr(table?.documentElement, 'ref');
      const region = ref ? tableRegion(ref, i, index, extra.tableStyles?.[i]) : null;
      if (region) regions.push(region);
    }
    if (regions.length) sheet.tables = regions;
  }

  if (extra.charts?.length) sheet.charts = extra.charts;
  return sheet;
}

/** Whether `bytes` open as a workbook at all — the cheap check before reading. */
export function looksLikeXlsx(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
