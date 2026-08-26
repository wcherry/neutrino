/**
 * The one place Neutrino's document model and OOXML are mapped to each other.
 *
 * The writer (`write.ts`) and the parser (`read.ts`) both read from here and
 * neither hard-codes a correspondence of its own. That is the point: a writer
 * and a parser maintained independently drift, and drift in this pair is
 * silent — the document still opens, it has just quietly lost its margins. A
 * shared table plus the round-trip property test in
 * `__tests__/ooxml/docxRoundTrip.test.ts` turns "lossless" into something that
 * stays true rather than something that was true once.
 *
 * ## Units
 *
 * OOXML measures in twips (1/20 pt, so 1440 to the inch), half-points for font
 * size, and EMUs (914400 to the inch) for anything in a drawing. The editor
 * measures in points for page setup and CSS pixels for everything else. Every
 * conversion lives here so no call site invents its own factor.
 *
 * ## What OOXML cannot hold
 *
 * Four things in the model have no OOXML equivalent, and they are all the same
 * shape — a live pointer at another Drive file, which no interchange format
 * models: `neutrino-drive:` image references, sheet embeds, diagram embeds, and
 * the `docTheme` preset name. A handful of presentational attributes (image
 * shadow/filter/caption, cross-reference target text) have no home either.
 *
 * Those go in `customXml/item1.xml` — see `EXTRAS_PART`. This is *not* the old
 * `neutrino/model.json` under a new name: that part held the entire document,
 * so `word/document.xml` was decorative and an edit made in Word was
 * unreadable. The extras part holds only what OOXML genuinely cannot express,
 * and the document itself is real OOXML that Word can round-trip.
 *
 * ## Canonicalisation
 *
 * Colours normalise to `#rrggbb` and font sizes to points, because OOXML has
 * exactly one spelling of each (`w:color/@w:val`, `w:sz` in half-points) and
 * carrying `rgb(255,0,0)` or `14px` through it would mean a second, redundant
 * copy of every styled run. The normalisation renders identically and happens
 * on the way in, so round-trip equality holds for anything the editor has
 * saved once. `normalizeColor` and `fontSizeToHalfPoints` are the only places
 * that decide this.
 */

import type { PageSetup } from '@neutrino/api-docs';
import type { LayoutMeta } from '@/lib/docBody';

// ── Model types ──────────────────────────────────────────────────────────────

/** A Tiptap/ProseMirror JSON node, as stored. */
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: DocMark[];
  text?: string;
}

export interface DocMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/** A whole document: the body plus the layout metadata that rides beside it. */
export interface DocModel {
  doc: DocNode;
  meta: LayoutMeta;
}

// ── Units ────────────────────────────────────────────────────────────────────

/** Points to twips. Page setup is in points; OOXML wants twentieths of one. */
export const ptToTwip = (pt: number): number => Math.round(pt * 20);
export const twipToPt = (twip: number): number => twip / 20;

/** CSS pixels (96dpi) to twips. 1px = 0.75pt = 15 twips. */
export const pxToTwip = (px: number): number => Math.round(px * 15);
export const twipToPx = (twip: number): number => twip / 15;

/** CSS pixels to EMUs, for image extents. 1px = 9525 EMU. */
export const pxToEmu = (px: number): number => Math.round(px * 9525);
export const emuToPx = (emu: number): number => emu / 9525;

/** One indent level in the editor is 24px of left margin. */
export const INDENT_PX_PER_LEVEL = 24;

// ── Page size ────────────────────────────────────────────────────────────────

/** Portrait dimensions in twips. Landscape swaps them. */
export const PAGE_SIZE_TWIPS: Record<PageSetup['pageSize'], { w: number; h: number }> = {
  letter: { w: 12240, h: 15840 },
  legal: { w: 12240, h: 20160 },
  tabloid: { w: 15840, h: 24480 },
  executive: { w: 10440, h: 15120 },
  a3: { w: 16838, h: 23814 },
  a4: { w: 11906, h: 16838 },
  a5: { w: 8391, h: 11906 },
};

/**
 * The page size whose portrait dimensions match `w`×`h`, or null.
 *
 * Matched with a tolerance because a document that has been through Word comes
 * back with its A4 height as 16840 rather than 16838 — Word rounds through
 * whole millimetres. Falling through to `letter` on a two-twip difference
 * would resize every A4 document that visited Word.
 */
export function pageSizeFromTwips(w: number, h: number): PageSetup['pageSize'] | null {
  const [pw, ph] = w > h ? [h, w] : [w, h];
  for (const [name, dim] of Object.entries(PAGE_SIZE_TWIPS)) {
    if (Math.abs(dim.w - pw) <= 20 && Math.abs(dim.h - ph) <= 20) {
      return name as PageSetup['pageSize'];
    }
  }
  return null;
}

// ── Enumerations ─────────────────────────────────────────────────────────────

/** Tiptap `textAlign` ↔ `w:jc/@w:val`. */
export const ALIGNMENT_TO_OOXML = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'both',
} as const;

export const OOXML_TO_ALIGNMENT: Record<string, keyof typeof ALIGNMENT_TO_OOXML> = {
  left: 'left',
  start: 'left',
  center: 'center',
  right: 'right',
  end: 'right',
  both: 'justify',
  distribute: 'justify',
};

/**
 * CSS `list-style-type` ↔ `w:numFmt/@w:val`.
 *
 * `disc`/`circle`/`square` are all `bullet` in OOXML — the shape lives in the
 * level's `w:lvlText` glyph instead, which is why the bullet character is
 * carried alongside.
 */
export const BULLET_GLYPH: Record<string, string> = {
  disc: '●',
  circle: '○',
  square: '■',
};

export const GLYPH_TO_BULLET: Record<string, string> = {
  '●': 'disc',
  '○': 'circle',
  '■': 'square',
  '•': 'disc',
  o: 'circle',
  '▪': 'square',
};

export const ORDERED_STYLE_TO_NUMFMT: Record<string, string> = {
  decimal: 'decimal',
  'lower-alpha': 'lowerLetter',
  'upper-alpha': 'upperLetter',
  'lower-roman': 'lowerRoman',
  'upper-roman': 'upperRoman',
};

export const NUMFMT_TO_ORDERED_STYLE: Record<string, string> = Object.fromEntries(
  Object.entries(ORDERED_STYLE_TO_NUMFMT).map(([k, v]) => [v, k]),
);

/**
 * Highlight colours ↔ `w:highlight/@w:val`.
 *
 * OOXML's highlight is a fixed sixteen-colour enumeration, not a free colour,
 * so an arbitrary highlight has to be matched to the nearest name. Anything
 * that does not match is written as a shaded run (`w:shd`) instead, which is a
 * free colour — see `write.ts`.
 */
/** The closed set `w:highlight/@w:val` accepts — the enumeration, spelled out. */
export type HighlightName =
  | 'yellow' | 'green' | 'cyan' | 'magenta' | 'blue' | 'red'
  | 'darkBlue' | 'darkCyan' | 'darkGreen' | 'darkMagenta' | 'darkRed'
  | 'darkYellow' | 'darkGray' | 'lightGray' | 'black' | 'white';

export const HIGHLIGHT_NAMES: Record<string, HighlightName> = {
  '#ffff00': 'yellow',
  '#00ff00': 'green',
  '#00ffff': 'cyan',
  '#ff00ff': 'magenta',
  '#0000ff': 'blue',
  '#ff0000': 'red',
  '#000080': 'darkBlue',
  '#008080': 'darkCyan',
  '#008000': 'darkGreen',
  '#800080': 'darkMagenta',
  '#800000': 'darkRed',
  '#808000': 'darkYellow',
  '#808080': 'darkGray',
  '#c0c0c0': 'lightGray',
  '#000000': 'black',
  '#ffffff': 'white',
};

export const NAME_TO_HIGHLIGHT: Record<string, string> = Object.fromEntries(
  Object.entries(HIGHLIGHT_NAMES).map(([hex, name]) => [name, hex]),
);

// ── Field codes ──────────────────────────────────────────────────────────────

/**
 * `docField` node codes ↔ Word field instructions.
 *
 * These are real Word fields (`w:fldSimple`), not text: a `{{page}}` written
 * as `PAGE` updates itself in Word, and comes back as a field rather than as
 * the number it happened to show when it was exported.
 *
 * The codes with no Word equivalent (`company`, `manager`, and any custom
 * `{{whatever}}`) go out as `DOCPROPERTY <name>`, which is how Word reads a
 * custom document property — so they resolve there too.
 */
export const FIELD_TO_INSTRUCTION: Record<string, string> = {
  page: 'PAGE',
  pages: 'NUMPAGES',
  title: 'TITLE',
  date: 'DATE',
  time: 'TIME',
  author: 'AUTHOR',
  subject: 'SUBJECT',
  keywords: 'KEYWORDS',
  filename: 'FILENAME',
};

export const INSTRUCTION_TO_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(FIELD_TO_INSTRUCTION).map(([k, v]) => [v, k]),
);

/** The `DOCPROPERTY` name for a code with no built-in Word field. */
export const docPropertyInstruction = (code: string): string => `DOCPROPERTY ${code}`;

// ── The extras part ──────────────────────────────────────────────────────────

/**
 * Where the handful of model attributes OOXML cannot express are stored.
 *
 * A custom XML part rather than a loose file at the package root: Word keeps
 * `customXml/` parts across an edit-and-save, and discards parts it does not
 * recognise. So a document that goes through Word comes back with its extras
 * intact, where the old `neutrino/model.json` would have been dropped.
 */
export const EXTRAS_PART = 'customXml/item1.xml';
export const EXTRAS_PROPS_PART = 'customXml/itemProps1.xml';
export const EXTRAS_NAMESPACE = 'https://neutrino.app/ns/doc-extras';

/**
 * Node-level data with no OOXML home, addressed by the node's index in
 * document order among nodes of the same kind.
 *
 * Indices rather than ids because the ids would have to be written into the
 * document to be found again, and every mechanism for that (bookmarks, content
 * controls) is one Word is free to renumber. An index degrades predictably
 * instead: edit the document in Word and the extras for anything after the
 * edit stop matching, so they are dropped and the base content — which is all
 * real OOXML — still reads. Full fidelity is a Neutrino-to-Neutrino property;
 * it cannot be anything else once another editor has had the file.
 */
export interface DocExtras {
  /** `docTheme`, and the background colour when it is not a plain fill. */
  theme?: string;
  /** Per-image extras, indexed by image order: shadow, filter, caption, ref. */
  images?: Record<number, { shadow?: string; filter?: string; caption?: string; driveRef?: string }>;
  /** Cross-reference target headings, indexed by cross-reference order. */
  crossRefs?: Record<number, string>;
  /**
   * Inline nodes written as a text placeholder, in document order.
   *
   * One list rather than one per kind, because the reader matches placeholders
   * by position and cannot tell an embed's `[Q1 sales]` from an unresolvable
   * image's `[Figure 1]` by looking at it. A single ordered channel makes the
   * question "which node was this" answerable instead of a guess.
   */
  placeholders?: { kind: string; attrs: Record<string, unknown> }[];
  /** `showCode` on a field, indexed by field order — a display toggle Word has no notion of. */
  fieldShowCode?: number[];
}

/**
 * Placeholder kinds that stood in for a *block* node rather than an inline one.
 *
 * A block placeholder is written as a paragraph of its own, so the parser has
 * to replace that whole paragraph; an inline one replaces a run inside a
 * paragraph that has other content. Getting it backwards puts a block node in
 * an inline position, which the editor's schema then discards. It is a fact
 * about the schema rather than about any document, so it is derived here
 * instead of being written into the extras.
 */
export const BLOCK_PLACEHOLDER_KINDS = new Set(['sheetEmbed', 'diagramEmbed']);

/**
 * The character style every placeholder run carries.
 *
 * The placeholder has to be findable again, and looking for italic text in
 * square brackets is not a way of finding it: an italic run written next to one
 * has the same properties, so the two are one run by the time the package is
 * read, `[Q1 sales]` is now `[Q1 sales]and the rest`, and the match fails —
 * taking every *later* placeholder in the document with it, since they are
 * restored in order. A style of its own gives the run a `w:rPr` no ordinary
 * italic shares, so it can never merge into its neighbour, and the parser
 * recognises it by name instead of by guessing.
 */
export const PLACEHOLDER_STYLE_ID = 'NeutrinoPlaceholder';

// ── Colour ───────────────────────────────────────────────────────────────────

const NAMED_COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000',
  blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff',
  gray: '#808080', grey: '#808080', transparent: '',
};

/**
 * A CSS colour as `#rrggbb`, or `''` when it is not a colour at all.
 *
 * Accepts the three spellings the editor can produce — hex (3 or 6 digit),
 * `rgb()`, and the handful of names a paste can bring in — because OOXML has
 * only one, and a run whose colour did not normalise would be written without
 * one at all.
 */
export function normalizeColor(input: string | null | undefined): string {
  if (!input) return '';
  const value = input.trim().toLowerCase();
  if (value in NAMED_COLORS) return NAMED_COLORS[value];

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (hex) {
    const h = hex[1];
    return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
  }

  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (rgb) {
    const to2 = (n: string) => Math.min(255, Number(n)).toString(16).padStart(2, '0');
    return `#${to2(rgb[1])}${to2(rgb[2])}${to2(rgb[3])}`;
  }
  return '';
}

/** `#rrggbb` as the bare `RRGGBB` OOXML wants in `w:val`. */
export const hexToOoxml = (hex: string): string => hex.replace('#', '').toUpperCase();

/** `RRGGBB` back to `#rrggbb`. `auto` means "the theme decides" and has no value. */
export function ooxmlToHex(val: string | null | undefined): string {
  if (!val || val.toLowerCase() === 'auto') return '';
  return `#${val.replace('#', '').toLowerCase()}`;
}

// ── Font size ────────────────────────────────────────────────────────────────

/**
 * A CSS font size as OOXML half-points, or null when it cannot be read.
 *
 * `px` is converted at the CSS ratio (1px = 0.75pt) rather than treated as
 * points — a 16px run written as 16pt is a third larger than it was on screen.
 */
export function fontSizeToHalfPoints(input: string | null | undefined): number | null {
  if (!input) return null;
  const m = /^([\d.]+)\s*(px|pt|)$/.exec(String(input).trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const pt = m[2] === 'px' ? n * 0.75 : n;
  return Math.round(pt * 2);
}

/** Half-points back to the `pt` string the editor stores. */
export const halfPointsToFontSize = (half: number): string => `${half / 2}pt`;

// ── Heading levels ───────────────────────────────────────────────────────────

/** `heading` level ↔ the `Heading1`…`Heading6` paragraph style id. */
export const headingStyleId = (level: number): string => `Heading${Math.min(6, Math.max(1, level))}`;

/** The level a paragraph style id denotes, or null when it is not a heading. */
export function headingLevelFromStyle(styleId: string | null | undefined): number | null {
  if (!styleId) return null;
  const m = /^heading\s*([1-6])$/i.exec(styleId.replace(/\s+/g, ' ').trim());
  return m ? Number(m[1]) : null;
}

// ── Marks ────────────────────────────────────────────────────────────────────

/**
 * The marks that are a plain on/off toggle in `w:rPr`, both ways.
 *
 * `code` maps to a run *style* rather than a toggle, and `link`, `textStyle`,
 * `highlight`, `crossRef` and the tracked-change pair all carry values, so
 * none of them are here — `write.ts` and `read.ts` handle those explicitly.
 */
export const TOGGLE_MARKS = {
  bold: 'b',
  italic: 'i',
  underline: 'u',
  strike: 'strike',
} as const;

export const OOXML_TO_TOGGLE_MARK: Record<string, keyof typeof TOGGLE_MARKS> = {
  b: 'bold',
  i: 'italic',
  u: 'underline',
  strike: 'strike',
};

/** `superscript`/`subscript` ↔ `w:vertAlign/@w:val`. */
export const VERT_ALIGN = { superscript: 'superscript', subscript: 'subscript' } as const;

/** The run style id used for the `code` mark, defined in `styles.xml` by the writer. */
export const CODE_STYLE_ID = 'NeutrinoCode';
/** The paragraph style id used for `codeBlock`. */
export const CODE_BLOCK_STYLE_ID = 'NeutrinoCodeBlock';
/** The paragraph style id used for `blockquote`. */
export const QUOTE_STYLE_ID = 'NeutrinoQuote';
