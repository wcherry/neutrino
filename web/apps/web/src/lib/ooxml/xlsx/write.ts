/**
 * The sheets editor's model → a real `.xlsx`.
 *
 * Every construct the editor holds is written as the SpreadsheetML element that
 * means it: values and formulas as `<v>`/`<f>`, number formats as `numFmt`,
 * fonts, fills and borders as entries in `styles.xml` that cells point at,
 * merges as `<mergeCells>`, column widths as `<cols>`, row heights as the `ht`
 * on `<row>`, a tab colour as `<tabColor>`, conditional formats as `<cfRule>`,
 * and a table region as a real `xl/tables/` part. Excel does not see a
 * projection of the spreadsheet; it sees the spreadsheet.
 *
 * Read this together with `read.ts`: they are two halves of one mapping and
 * `__tests__/ooxml/xlsxRoundTrip.test.ts` asserts they agree. A change here
 * with no counterpart there is a change that loses data.
 *
 * The parts are assembled by hand rather than through SheetJS, which the
 * editor still uses for reading foreign workbooks and for CSV export: its
 * community build cannot write cell styles, conditional formats or tables at
 * all, which is the whole reason the model part existed.
 *
 * `mapping.ts` explains what is left over and why it goes to `customXml`.
 */

import type { JSZipObject } from 'jszip';
import {
  BUILTIN_FORMATS, CF_HEAT_MAP_PRESETS, CF_ICON_SET, CF_OPERATOR, CF_THEME_COLORS,
  CF_TIME_PERIOD, EXTRAS_NAMESPACE, EXTRAS_PART, EXTRAS_PROPS_PART,
  FIRST_CUSTOM_FORMAT_ID, H_ALIGN, NS_MAIN, NS_REL, V_ALIGN, XML_DECL,
  borderStyleName, formatCodeFor, needsCfExtra, numberToColumn, parseCellId,
  pxToCharWidth, pxToPoints, toArgb, xmlEscape, xmlSafe,
  type BorderSide, type CFRule, type CFStyle, type CellStyle, type SavedCell,
  type SheetData, type SheetExtra, type SheetExtras, type SheetFile,
} from './mapping';

// ── The style table ───────────────────────────────────────────────────────────

/**
 * `styles.xml` is a set of tables that cells index into, so every distinct
 * font, fill, border and format is written once however many cells wear it.
 * This accumulates them and hands back the index to put on the cell.
 */
class StyleTable {
  private readonly numFmts = new Map<string, number>();
  private readonly fonts = new Map<string, number>([['', 0]]);
  private readonly fills = new Map<string, number>([['', 0], ['gray125', 1]]);
  private readonly borders = new Map<string, number>([['', 0]]);
  private readonly xfs = new Map<string, number>([['0|0|0|0|', 0]]);
  private readonly fontXml: string[] = ['<font><sz val="11"/><name val="Calibri"/></font>'];
  private readonly fillXml: string[] = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
  ];
  private readonly borderXml: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  private readonly xfXml: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private readonly numFmtXml: string[] = [];
  /** Differential formats, which conditional-format rules point at. */
  private readonly dxfXml: string[] = [];

  /** The `cellXfs` index for a cell style; 0 for a cell with none. */
  cellStyle(style: CellStyle | undefined): number {
    if (!style) return 0;
    const numFmtId = this.numberFormat(style);
    const fontId = this.font(style);
    const fillId = this.fill(style);
    const borderId = this.border(style);
    const alignment = alignmentXml(style);
    const key = `${numFmtId}|${fontId}|${fillId}|${borderId}|${alignment}`;
    const existing = this.xfs.get(key);
    if (existing !== undefined) return existing;
    const index = this.xfXml.length;
    const applies = [
      numFmtId ? ' applyNumberFormat="1"' : '',
      fontId ? ' applyFont="1"' : '',
      fillId ? ' applyFill="1"' : '',
      borderId ? ' applyBorder="1"' : '',
      alignment ? ' applyAlignment="1"' : '',
    ].join('');
    this.xfXml.push(
      `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${applies}>`
      + `${alignment}</xf>`,
    );
    this.xfs.set(key, index);
    return index;
  }

  /** The `dxfs` index for a conditional format's styling. */
  differential(format: CFStyle | undefined): number | null {
    if (!format) return null;
    const font: string[] = [];
    if (format.fontWeight === 'bold') font.push('<b/>');
    if (format.fontStyle === 'italic') font.push('<i/>');
    if (format.textDecoration === 'underline') font.push('<u/>');
    const color = toArgb(format.color);
    if (color) font.push(`<color rgb="${color}"/>`);
    const background = toArgb(format.backgroundColor);
    const parts = [
      font.length ? `<font>${font.join('')}</font>` : '',
      background ? `<fill><patternFill><bgColor rgb="${background}"/></patternFill></fill>` : '',
    ].join('');
    if (!parts) return null;
    const index = this.dxfXml.length;
    this.dxfXml.push(`<dxf>${parts}</dxf>`);
    return index;
  }

  private numberFormat(style: CellStyle): number {
    const code = formatCodeFor(style);
    if (!code || code === 'General') return 0;
    for (const [id, builtin] of Object.entries(BUILTIN_FORMATS)) {
      if (builtin === code) return Number(id);
    }
    const existing = this.numFmts.get(code);
    if (existing !== undefined) return existing;
    const id = FIRST_CUSTOM_FORMAT_ID + this.numFmts.size;
    this.numFmts.set(code, id);
    this.numFmtXml.push(`<numFmt numFmtId="${id}" formatCode="${xmlEscape(xmlSafe(code))}"/>`);
    return id;
  }

  private font(style: CellStyle): number {
    const size = style.fontSize ? parseFloat(style.fontSize) : null;
    const color = toArgb(style.color);
    const parts = [
      style.fontWeight === 'bold' ? '<b/>' : '',
      style.fontStyle === 'italic' ? '<i/>' : '',
      style.textDecoration === 'line-through' ? '<strike/>' : '',
      size && !Number.isNaN(size) ? `<sz val="${size}"/>` : '<sz val="11"/>',
      color ? `<color rgb="${color}"/>` : '',
      `<name val="${xmlEscape(xmlSafe(style.fontFamily || 'Calibri'))}"/>`,
    ].join('');
    const xml = `<font>${parts}</font>`;
    return this.intern(this.fonts, this.fontXml, xml, 0);
  }

  private fill(style: CellStyle): number {
    const color = toArgb(style.backgroundColor);
    if (!color) return 0;
    // `fgColor` is the one that paints for a solid pattern; `bgColor` is behind
    // it and shows through only for the hatched patterns.
    const xml = `<fill><patternFill patternType="solid"><fgColor rgb="${color}"/>`
      + `<bgColor indexed="64"/></patternFill></fill>`;
    return this.intern(this.fills, this.fillXml, xml, 0);
  }

  private border(style: CellStyle): number {
    const sides: Record<BorderSide, string> = {
      borderLeft: 'left', borderRight: 'right', borderTop: 'top', borderBottom: 'bottom',
    };
    const parts = (Object.keys(sides) as BorderSide[]).map((side) => {
      const weight = borderStyleName(style[side] ?? style.borderStyle);
      const tag = sides[side];
      return weight ? `<${tag} style="${weight}"><color rgb="FF000000"/></${tag}>` : `<${tag}/>`;
    });
    // OOXML wants the sides in this order and a diagonal after them.
    const xml = `<border>${parts[0]}${parts[1]}${parts[2]}${parts[3]}<diagonal/></border>`;
    return this.intern(this.borders, this.borderXml, xml, 0);
  }

  private intern(seen: Map<string, number>, xml: string[], value: string, empty: number): number {
    const existing = seen.get(value);
    if (existing !== undefined) return existing;
    if (value === xml[empty]) return empty;
    const index = xml.length;
    xml.push(value);
    seen.set(value, index);
    return index;
  }

  toXml(): string {
    const numFmts = this.numFmtXml.length
      ? `<numFmts count="${this.numFmtXml.length}">${this.numFmtXml.join('')}</numFmts>`
      : '';
    const dxfs = this.dxfXml.length
      ? `<dxfs count="${this.dxfXml.length}">${this.dxfXml.join('')}</dxfs>`
      : '<dxfs count="0"/>';
    return `${XML_DECL}<styleSheet xmlns="${NS_MAIN}">${numFmts}`
      + `<fonts count="${this.fontXml.length}">${this.fontXml.join('')}</fonts>`
      + `<fills count="${this.fillXml.length}">${this.fillXml.join('')}</fills>`
      + `<borders count="${this.borderXml.length}">${this.borderXml.join('')}</borders>`
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + `<cellXfs count="${this.xfXml.length}">${this.xfXml.join('')}</cellXfs>`
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + `${dxfs}</styleSheet>`;
  }
}

function alignmentXml(style: CellStyle): string {
  const horizontal = style.textAlign ? H_ALIGN[style.textAlign] : null;
  const vertical = style.verticalAlign ? V_ALIGN[style.verticalAlign] : null;
  const wrap = style.wrapMode === 'wrap';
  if (!horizontal && !vertical && !wrap) return '';
  return `<alignment${horizontal ? ` horizontal="${horizontal}"` : ''}`
    + `${vertical ? ` vertical="${vertical}"` : ''}${wrap ? ' wrapText="1"' : ''}/>`;
}

// ── Cells ─────────────────────────────────────────────────────────────────────

/**
 * Text that is a number OOXML can store as one, matched narrowly.
 *
 * Narrowly because `Number()` accepts a great deal that must *not* become a
 * number in a spreadsheet: `0015` is a product code, `1e5` and `0x1f` are text
 * someone typed, and storing any of them as their numeric value loses the cell
 * the user entered. Leading zeros are the case that actually bites — a column
 * of zip codes silently loses its first digit.
 */
const NUMERIC = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$|^-?\.\d+$/;

/** A number if the text is one, `null` otherwise. Blank is not a number. */
function numericValue(text: string | undefined): number | null {
  if (text === undefined || !NUMERIC.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function cellXml(id: string, cell: SavedCell, styleIndex: number): string {
  const s = styleIndex ? ` s="${styleIndex}"` : '';
  const raw = cell.raw ?? '';
  if (raw.startsWith('=')) {
    // The cached value goes in beside the formula, so a reader that does not
    // evaluate — Excel before a recalculation, and `read.ts` — still has it.
    const formula = xmlEscape(xmlSafe(raw.slice(1)));
    const cached = cell.value ?? '';
    const numeric = numericValue(cached);
    if (numeric !== null) return `<c r="${id}"${s}><f>${formula}</f><v>${numeric}</v></c>`;
    if (cached === '') return `<c r="${id}"${s}><f>${formula}</f></c>`;
    return `<c r="${id}"${s} t="str"><f>${formula}</f><v>${xmlEscape(xmlSafe(cached))}</v></c>`;
  }
  const numeric = numericValue(raw);
  if (numeric !== null) return `<c r="${id}"${s}><v>${numeric}</v></c>`;
  if (raw === '') return s ? `<c r="${id}"${s}/>` : '';
  // Inline rather than shared strings: one fewer part, one fewer table to keep
  // consistent, and no measurable size difference at spreadsheet scale.
  return `<c r="${id}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(xmlSafe(raw))}</t></is></c>`;
}

// ── Conditional formats ───────────────────────────────────────────────────────

/** The top-left cell of a range, which relative CF formulas are written against. */
function firstCellOf(range: string): string {
  const first = range.split(':')[0].replace(/\$/g, '');
  return parseCellId(first) ? first : 'A1';
}

interface CfContext {
  styles: StyleTable;
  priority: () => number;
}

/**
 * One rule as `<cfRule>` elements.
 *
 * A rule OOXML has an operator for is written as itself. One it does not —
 * a progress bar, a status indicator, a heat map, a theme token, a reference to
 * a named variable — is written as the nearest thing OOXML *does* have, so a
 * workbook opened in Excel shows the cell as flagged rather than as plain, and
 * `write.ts`'s caller records the exact rule in the extras part.
 */
function cfRuleXml(rule: CFRule, ctx: CfContext): string {
  const spec = rule.rule;
  const stop = rule.stopIfTrue ? ' stopIfTrue="1"' : '';
  const anchor = firstCellOf(rule.range);
  const dxf = (format: CFStyle | undefined) => {
    const id = ctx.styles.differential(format);
    return id === null ? '' : ` dxfId="${id}"`;
  };
  const p = () => ` priority="${ctx.priority()}"`;

  switch (spec.kind) {
    case 'singleColor': {
      const format = dxf(spec.format);
      const text = spec.value ?? '';
      if (spec.condition === 'isEmpty' || spec.condition === 'isNotEmpty') {
        const type = spec.condition === 'isEmpty' ? 'containsBlanks' : 'notContainsBlanks';
        const formula = spec.condition === 'isEmpty'
          ? `LEN(TRIM(${anchor}))=0`
          : `LEN(TRIM(${anchor}))&gt;0`;
        return `<cfRule type="${type}"${format}${p()}${stop}><formula>${formula}</formula></cfRule>`;
      }
      if (spec.condition === 'containsText') {
        const quoted = `"${text.replace(/"/g, '""')}"`;
        return `<cfRule type="containsText"${format}${p()}${stop} operator="containsText"`
          + ` text="${xmlEscape(xmlSafe(text))}">`
          + `<formula>NOT(ISERROR(SEARCH(${xmlEscape(quoted)},${anchor})))</formula></cfRule>`;
      }
      const period = CF_TIME_PERIOD[spec.condition];
      if (period) {
        return `<cfRule type="timePeriod"${format}${p()}${stop} timePeriod="${period}">`
          + `<formula>FLOOR(${anchor},1)=TODAY()</formula></cfRule>`;
      }
      if (spec.condition === 'dateIsPastDue') {
        // No `timePeriod` means "before today", so it is written as the
        // comparison it is; the extras entry is what restores the date framing.
        return `<cfRule type="cellIs"${format}${p()}${stop} operator="lessThan">`
          + `<formula>TODAY()</formula></cfRule>`;
      }
      const operator = CF_OPERATOR[spec.condition];
      if (!operator) return '';
      const formulas = operator === 'between'
        ? `<formula>${cfValue(spec.value)}</formula><formula>${cfValue(spec.value2)}</formula>`
        : `<formula>${cfValue(spec.value)}</formula>`;
      return `<cfRule type="cellIs"${format}${p()}${stop} operator="${operator}">${formulas}</cfRule>`;
    }
    case 'formula':
      return `<cfRule type="expression"${dxf(spec.format)}${p()}${stop}>`
        + `<formula>${xmlEscape(xmlSafe(spec.formula.replace(/^=/, '')))}</formula></cfRule>`;
    case 'duplicates':
    case 'uniques': {
      const type = spec.kind === 'duplicates' ? 'duplicateValues' : 'uniqueValues';
      return `<cfRule type="${type}"${dxf(spec.format)}${p()}${stop}/>`;
    }
    case 'topBottom':
      return `<cfRule type="top10"${dxf(spec.format)}${p()}${stop} rank="${spec.value}"`
        + `${spec.direction === 'bottom' ? ' bottom="1"' : ''}`
        + `${spec.type === 'percent' ? ' percent="1"' : ''}/>`;
    case 'average':
      return `<cfRule type="aboveAverage"${dxf(spec.format)}${p()}${stop}`
        + `${spec.direction === 'below' ? ' aboveAverage="0"' : ''}/>`;
    case 'colorScale':
      return colorScaleXml(
        spec.midColor ? [spec.minColor, spec.midColor, spec.maxColor] : [spec.minColor, spec.maxColor],
        p(),
        stop,
      );
    case 'heatMap': {
      const preset = CF_HEAT_MAP_PRESETS[spec.preset] ?? CF_HEAT_MAP_PRESETS.financial;
      return colorScaleXml(
        [spec.lowColor || preset[0], spec.midColor || preset[1], spec.highColor || preset[2]],
        p(),
        stop,
      );
    }
    case 'dataBar':
      return dataBarXml(spec.color, p(), stop);
    case 'progressBar':
      // A data bar is what a progress bar is, minus the explicit range and the
      // label; both come back from the extras entry.
      return dataBarXml(spec.color, p(), stop, spec.minValue, spec.maxValue);
    case 'iconSet': {
      const set = CF_ICON_SET[spec.iconSet] ?? CF_ICON_SET.trafficLights;
      return `<cfRule type="iconSet"${p()}${stop}><iconSet iconSet="${set}">`
        + '<cfvo type="percent" val="0"/><cfvo type="percent" val="33"/>'
        + '<cfvo type="percent" val="67"/></iconSet></cfRule>';
    }
    case 'statusIndicator':
      // Three states, however the template names them.
      return `<cfRule type="iconSet"${p()}${stop}><iconSet iconSet="3TrafficLights1">`
        + '<cfvo type="percent" val="0"/><cfvo type="percent" val="33"/>'
        + '<cfvo type="percent" val="67"/></iconSet></cfRule>';
    case 'themeColor': {
      const format = CF_THEME_COLORS[spec.token];
      return cfRuleXml(
        { ...rule, rule: { kind: 'singleColor', condition: spec.condition, value: spec.value, value2: spec.value2, format } },
        ctx,
      );
    }
    case 'variable':
      // The definition lives in `cfVariables`, which is itself an extras entry,
      // and resolving it belongs to the editor. A rule that never fires is
      // written so the position is still occupied: the extras entries are
      // indexed by rule order, and a gap here would shift every one after it.
      return `<cfRule type="expression"${p()}${stop}><formula>FALSE()</formula></cfRule>`;
  }
}

/** A CF comparison value: a number as itself, anything else quoted. */
function cfValue(value: string | undefined): string {
  const text = value ?? '';
  if (text.trim() !== '' && Number.isFinite(Number(text))) return text;
  return xmlEscape(xmlSafe(`"${text.replace(/"/g, '""')}"`));
}

function colorScaleXml(colors: string[], priority: string, stop: string): string {
  const points = colors.length === 3
    ? '<cfvo type="min"/><cfvo type="percentile" val="50"/><cfvo type="max"/>'
    : '<cfvo type="min"/><cfvo type="max"/>';
  const rgb = colors.map((c) => `<color rgb="${toArgb(c) ?? 'FFFFFFFF'}"/>`).join('');
  return `<cfRule type="colorScale"${priority}${stop}><colorScale>${points}${rgb}</colorScale></cfRule>`;
}

function dataBarXml(color: string, priority: string, stop: string, min?: number, max?: number): string {
  const low = min === undefined ? '<cfvo type="min"/>' : `<cfvo type="num" val="${min}"/>`;
  const high = max === undefined ? '<cfvo type="max"/>' : `<cfvo type="num" val="${max}"/>`;
  return `<cfRule type="dataBar"${priority}${stop}><dataBar>${low}${high}`
    + `<color rgb="${toArgb(color) ?? 'FF638EC6'}"/></dataBar></cfRule>`;
}

// ── Worksheets ────────────────────────────────────────────────────────────────

interface WrittenSheet {
  xml: string;
  /** Table parts this sheet owns, as `[partPath, xml]`. */
  tables: [string, string][];
  extra: SheetExtra;
}

function writeSheet(sheet: SheetData, index: number, styles: StyleTable, tableIdBase: number): WrittenSheet {
  const extra: SheetExtra = {};

  // ── Cells, grouped into rows in ascending order, as OOXML requires.
  const rows = new Map<number, { id: string; cell: SavedCell; col: number }[]>();
  let maxCol = 0;
  let maxRow = 0;
  const clipped: string[] = [];
  for (const [id, cell] of Object.entries(sheet.cells)) {
    const at = parseCellId(id);
    if (!at) continue;
    if (cell.cellStyle?.wrapMode === 'clip') clipped.push(id);
    const row = rows.get(at.row) ?? [];
    row.push({ id, cell, col: at.col });
    rows.set(at.row, row);
    if (at.col > maxCol) maxCol = at.col;
    if (at.row > maxRow) maxRow = at.row;
  }
  if (clipped.length) extra.clipped = clipped.sort();

  const heights = sheet.rowHeights ?? {};
  const rowXml = [...rows.keys()].sort((a, b) => a - b).map((r) => {
    const cells = rows.get(r)!
      .sort((a, b) => a.col - b.col)
      .map(({ id, cell }) => cellXml(id, cell, styles.cellStyle(cell.cellStyle)))
      .join('');
    // Heights are keyed 0-based in the model and rows are 1-based here.
    const height = heights[String(r - 1)];
    const ht = typeof height === 'number' ? ` ht="${pxToPoints(height)}" customHeight="1"` : '';
    return `<row r="${r}"${ht}>${cells}</row>`;
  }).join('');

  // ── Column widths, one `<col>` per sized column.
  const widths = sheet.colWidths ?? {};
  const colXml = Object.entries(widths)
    .map(([key, px]) => ({ index: Number(key) + 1, px }))
    .filter(({ index, px }) => Number.isFinite(index) && index > 0 && typeof px === 'number')
    .sort((a, b) => a.index - b.index)
    .map(({ index, px }) =>
      `<col min="${index}" max="${index}" width="${pxToCharWidth(px).toFixed(4)}" customWidth="1"/>`)
    .join('');

  // ── Merges, from the anchors; the covered cells are re-derived on read.
  const merges: string[] = [];
  for (const [id, cell] of Object.entries(sheet.cells)) {
    const span = { cols: cell.colSpan ?? 1, rows: cell.rowSpan ?? 1 };
    if (span.cols <= 1 && span.rows <= 1) continue;
    const at = parseCellId(id);
    if (!at) continue;
    const end = `${numberToColumn(at.col + span.cols - 1)}${at.row + span.rows - 1}`;
    merges.push(`<mergeCell ref="${id}:${end}"/>`);
  }
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : '';

  // ── Conditional formats. One `<conditionalFormatting>` per rule keeps the
  // model's order, which is what the extras entries are indexed by.
  let priority = 1;
  const ctx: CfContext = { styles, priority: () => priority++ };
  const cfExtras: Record<number, CFRule> = {};
  const cfXml = (sheet.conditionalFormats ?? []).map((rule, i) => {
    if (needsCfExtra(rule.rule)) cfExtras[i] = rule;
    const body = cfRuleXml(rule, ctx);
    return body ? `<conditionalFormatting sqref="${xmlEscape(rule.range)}">${body}</conditionalFormatting>` : '';
  }).join('');
  if (Object.keys(cfExtras).length) extra.conditionalFormats = cfExtras;
  if (sheet.cfVariables?.length) extra.cfVariables = sheet.cfVariables;

  // ── Tables. The region is a real table part; its Neutrino style id is not.
  const tables: [string, string][] = [];
  const tableStyles: Record<number, string> = {};
  const tableRels: string[] = [];
  (sheet.tables ?? []).forEach((region, i) => {
    const id = tableIdBase + i;
    const ref = `${numberToColumn(region.minC)}${region.minR}:${numberToColumn(region.maxC)}${region.maxR}`;
    const columns = [];
    for (let c = region.minC; c <= region.maxC; c++) {
      const header = sheet.cells[`${numberToColumn(c)}${region.minR}`]?.raw?.trim();
      const name = header || `Column${c - region.minC + 1}`;
      columns.push(`<tableColumn id="${c - region.minC + 1}" name="${xmlEscape(xmlSafe(name))}"/>`);
    }
    tables.push([`xl/tables/table${id}.xml`,
      `${XML_DECL}<table xmlns="${NS_MAIN}" id="${id}" name="Table${id}" displayName="Table${id}"`
      + ` ref="${ref}" totalsRowShown="0"><autoFilter ref="${ref}"/>`
      + `<tableColumns count="${columns.length}">${columns.join('')}</tableColumns>`
      + '<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0"'
      + ' showRowStripes="1" showColumnStripes="0"/></table>']);
    tableRels.push(`<tablePart r:id="rId${i + 1}"/>`);
    if (region.styleId) tableStyles[i] = region.styleId;
  });
  if (Object.keys(tableStyles).length) extra.tableStyles = tableStyles;
  if (sheet.charts?.length) extra.charts = sheet.charts;

  const tabColor = toArgb(sheet.color);
  const dimension = maxRow > 0 ? `<dimension ref="A1:${numberToColumn(maxCol)}${maxRow}"/>` : '';
  // The element order below is the schema's, and Excel enforces it.
  const xml = `${XML_DECL}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`
    + (tabColor ? `<sheetPr><tabColor rgb="${tabColor}"/></sheetPr>` : '')
    + dimension
    + `<sheetFormatPr defaultRowHeight="15"/>`
    + (colXml ? `<cols>${colXml}</cols>` : '')
    + `<sheetData>${rowXml}</sheetData>`
    + mergeXml
    + cfXml
    + (tableRels.length ? `<tableParts count="${tableRels.length}">${tableRels.join('')}</tableParts>` : '')
    + '</worksheet>';

  return { xml, tables, extra: Object.keys(extra).length ? extra : {} };
}

// ── The extras part ───────────────────────────────────────────────────────────

function extrasXml(extras: SheetExtras): string {
  return `${XML_DECL}<sheetExtras xmlns="${EXTRAS_NAMESPACE}" version="1">`
    + `<payload>${xmlEscape(xmlSafe(JSON.stringify(extras)))}</payload></sheetExtras>`;
}

// ── Names ─────────────────────────────────────────────────────────────────────

const INVALID_IN_TAB_NAME = /[[\]:*?/\\]/g;
const MAX_TAB_NAME = 31;

/**
 * Tab names a workbook will accept.
 *
 * Excel rejects a name that is empty, over 31 characters, duplicated, wrapped
 * in apostrophes or holding one of `[]:*?/\` — and a sheet is named by whoever
 * made it, here or in the file this came from. Repairing is the only option
 * that keeps the spreadsheet: refusing would fail the save.
 */
export function tabNames(sheets: SheetData[]): string[] {
  const used = new Set<string>();
  return sheets.map((sheet, index) => {
    const cleaned = (sheet.name ?? '')
      .replace(INVALID_IN_TAB_NAME, ' ')
      .replace(/^'+|'+$/g, '')
      .trim()
      .slice(0, MAX_TAB_NAME)
      .trim();
    const base = cleaned || `Sheet${index + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      name = base.slice(0, MAX_TAB_NAME - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * `file` as `.xlsx` bytes.
 *
 * `keep` is an existing package to preserve the unrecognised parts of — charts,
 * pivot tables, images and anything else another tool put there. Without it the
 * workbook is written from the model alone, which is what a new spreadsheet and
 * a CSV import both want.
 */
export async function writeXlsx(file: SheetFile, keep?: Uint8Array): Promise<Uint8Array> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  // The editor treats a workbook with no tabs as empty and keeps its own
  // default; one empty tab is what "this file was empty" means everywhere else.
  const sheets = file.sheets.length > 0 ? file.sheets : [{ name: 'Sheet 1', cells: {} }];
  const names = tabNames(sheets);
  const styles = new StyleTable();

  const extras: SheetExtras = { sheets: {} };
  let tableId = 1;
  const written = sheets.map((sheet, i) => {
    const out = writeSheet(sheet, i, styles, tableId);
    tableId += out.tables.length;
    if (Object.keys(out.extra).length) extras.sheets![i] = out.extra;
    return out;
  });
  const hasExtras = Object.keys(extras.sheets!).length > 0;

  // ── Parts.
  written.forEach((sheet, i) => {
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheet.xml);
    for (const [path, xml] of sheet.tables) zip.file(path, xml);
    if (sheet.tables.length) {
      const rels = sheet.tables.map(([path], t) =>
        `<Relationship Id="rId${t + 1}" Type="${NS_REL}/table" Target="../${path.replace('xl/', '')}"/>`).join('');
      zip.file(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `${rels}</Relationships>`);
    }
  });

  zip.file('xl/styles.xml', styles.toXml());

  const sheetEntries = names.map((name, i) =>
    `<sheet name="${xmlEscape(xmlSafe(name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  zip.file('xl/workbook.xml',
    `${XML_DECL}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`
    + `<sheets>${sheetEntries}</sheets></workbook>`);

  const stylesRelId = names.length + 1;
  const extrasRelId = names.length + 2;
  const workbookRels = [
    ...names.map((_, i) =>
      `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`),
    `<Relationship Id="rId${stylesRelId}" Type="${NS_REL}/styles" Target="styles.xml"/>`,
    hasExtras
      ? `<Relationship Id="rId${extrasRelId}" Type="${NS_REL}/customXml" Target="../${EXTRAS_PART}"/>`
      : '',
  ].join('');
  zip.file('xl/_rels/workbook.xml.rels',
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `${workbookRels}</Relationships>`);

  zip.file('_rels/.rels',
    `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);

  if (hasExtras) {
    zip.file(EXTRAS_PART, extrasXml(extras));
    zip.file(EXTRAS_PROPS_PART,
      `${XML_DECL}<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"`
      + ' ds:itemID="{4E9C2B71-9F3C-4E77-9E3E-1C2D3A4B5C6D}">'
      + `<ds:schemaRefs><ds:schemaRef ds:uri="${EXTRAS_NAMESPACE}"/></ds:schemaRefs></ds:datastoreItem>`);
    zip.file('customXml/_rels/item1.xml.rels',
      `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="${NS_REL}/customXmlProps" Target="itemProps1.xml"/></Relationships>`);
  }

  // ── Parts from a package this is replacing that nothing here understands.
  const carried = keep ? await carryForeignParts(zip, keep) : [];

  const overrides = [
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    ...names.map((_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`),
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ...written.flatMap((sheet) => sheet.tables.map(([path]) =>
      `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`)),
    hasExtras
      ? `<Override PartName="/${EXTRAS_PROPS_PART}" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>`
      : '',
    ...carried,
  ].join('');
  zip.file('[Content_Types].xml',
    `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="png" ContentType="image/png"/>'
    + '<Default Extension="jpeg" ContentType="image/jpeg"/>'
    + `${overrides}</Types>`);

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/**
 * Copy the parts of `previous` this writer has no notion of into `zip`, and
 * return the content-type overrides they need.
 *
 * A workbook that has been through Excel can carry pivot tables, images, VML
 * and charts. None of them are written here, and dropping them on every save
 * would make Neutrino the tool that quietly deletes your pivot table. They are
 * carried instead — inert, but still in the file when it goes back to Excel.
 *
 * Only parts under `xl/` that this writer does not itself produce are taken,
 * and never the relationship files, which name parts by ids this rewrites.
 */
async function carryForeignParts(zip: import('jszip'), previous: Uint8Array): Promise<string[]> {
  const JSZip = (await import('jszip')).default;
  let old: import('jszip');
  try {
    old = await JSZip.loadAsync(previous);
  } catch {
    return [];
  }
  const ours = /^xl\/(workbook\.xml|styles\.xml|worksheets\/|tables\/|sharedStrings\.xml)|_rels|\[Content_Types\]/;
  const types = await readContentTypes(old);
  const overrides: string[] = [];
  const entries = Object.entries(old.files) as [string, JSZipObject][];
  for (const [path, entry] of entries) {
    if (entry.dir || !path.startsWith('xl/') || ours.test(path) || path.includes('/_rels/')) continue;
    if (zip.file(path)) continue;
    zip.file(path, await entry.async('uint8array'));
    const type = types.get(`/${path}`);
    if (type) overrides.push(`<Override PartName="/${path}" ContentType="${type}"/>`);
  }
  return overrides;
}

/** The `[Content_Types].xml` overrides of a package, by part name. */
async function readContentTypes(zip: import('jszip')): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const part = zip.file('[Content_Types].xml');
  if (!part) return out;
  const xml = await part.async('string');
  for (const m of xml.matchAll(/<Override\s+PartName="([^"]+)"\s+ContentType="([^"]+)"\s*\/>/g)) {
    out.set(m[1], m[2]);
  }
  return out;
}
