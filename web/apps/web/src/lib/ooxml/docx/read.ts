/**
 * A `.docx` → Neutrino's document model.
 *
 * The other half of `write.ts`, and the half that did not exist: documents were
 * read with mammoth, which converts a `.docx` to semantic HTML and deliberately
 * discards presentation. Measured against a document containing page setup, a
 * header, a footer, columns, a footnote, colour, size, alignment, indent and
 * cell shading, mammoth returned the text and the table structure and dropped
 * everything else — silently, with no warnings. That is correct behaviour for
 * what mammoth is for and unusable as the read side of a round trip.
 *
 * So this reads the parts directly: `document.xml` for the body,
 * `numbering.xml` for what a list looks like, `footnotes.xml` for the notes,
 * the header and footer parts named by `sectPr`, `docProps/*` for the document
 * properties, and the custom XML part for the handful of things OOXML cannot
 * say (see `mapping.ts`).
 *
 * Anything it does not recognise degrades to its text rather than vanishing.
 * A `.docx` from Word is a document written by software that knows constructs
 * this does not, and losing a paragraph is much worse than losing its styling.
 *
 * ## Known gap: `styles.xml` is not resolved
 *
 * A paragraph's style is read as an id — `Heading2` is a heading because it is
 * spelled that way. That covers what this writer emits and what Word emits in
 * English, and misses two real cases: a document whose heading styles are
 * named in another language, and one using a custom style that is `basedOn` a
 * heading. Both currently read as body paragraphs with their text intact.
 * Closing it means resolving `styles.xml` and walking `basedOn` chains, which
 * belongs here and is not done.
 */

import { DEFAULT_PAGE_SETUP, type PageSetup } from '@neutrino/api-docs';
import type { LayoutMeta } from '@/lib/docBody';
import type { HeaderFooterConfig, HeaderFooterSlots, HeaderFooterVariant } from '@/lib/docHeaderFooter';
import { emptyDocProperties } from '@/lib/docFields';
import {
  BLOCK_PLACEHOLDER_KINDS,
  EXTRAS_PART, GLYPH_TO_BULLET, INDENT_PX_PER_LEVEL, INSTRUCTION_TO_FIELD,
  NAME_TO_HIGHLIGHT, NUMFMT_TO_ORDERED_STYLE, OOXML_TO_ALIGNMENT,
  OOXML_TO_TOGGLE_MARK, CODE_BLOCK_STYLE_ID, CODE_STYLE_ID, PLACEHOLDER_STYLE_ID,
  QUOTE_STYLE_ID,
  halfPointsToFontSize, headingLevelFromStyle, ooxmlToHex, pageSizeFromTwips,
  twipToPt, twipToPx,
  type DocExtras, type DocMark, type DocModel, type DocNode,
} from './mapping';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// ── XML helpers ──────────────────────────────────────────────────────────────

/** Direct element children named `name`, ignoring which prefix was used. */
function kids(el: Element | null | undefined, name: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (const child of Array.from(el.children)) {
    if (child.localName === name) out.push(child);
  }
  return out;
}

const kid = (el: Element | null | undefined, name: string): Element | null =>
  kids(el, name)[0] ?? null;

/** A namespaced attribute, tolerating a document that declared no namespace. */
function attr(el: Element | null, name: string, ns = W): string | null {
  if (!el) return null;
  return el.getAttributeNS(ns, name) ?? el.getAttribute(`w:${name}`) ?? el.getAttribute(name);
}

const wval = (el: Element | null): string | null => attr(el, 'val');

/**
 * Whether a toggle property is on.
 *
 * `<w:b/>` means bold, and so does `<w:b w:val="true"/>`; `<w:b w:val="false"/>`
 * means the opposite and is what a run inside a bold style uses to turn it back
 * off. Reading the element's presence alone bolds text that was explicitly
 * un-bolded.
 */
function toggleOn(el: Element | null): boolean {
  if (!el) return false;
  const v = wval(el);
  return v === null || v === '' || v === 'true' || v === '1' || v === 'on';
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

// ── Package ──────────────────────────────────────────────────────────────────

interface Package {
  part(path: string): Promise<string | null>;
  bytes(path: string): Promise<Uint8Array | null>;
  names: string[];
}

async function openPackage(input: Uint8Array): Promise<Package> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(input);
  return {
    names: Object.keys(zip.files),
    async part(path) {
      const f = zip.file(path);
      return f ? f.async('string') : null;
    },
    async bytes(path) {
      const f = zip.file(path);
      return f ? f.async('uint8array') : null;
    },
  };
}

// ── Relationships ────────────────────────────────────────────────────────────

type Rels = Map<string, string>;

async function readRels(pkg: Package, partPath: string): Promise<Rels> {
  const dir = partPath.slice(0, partPath.lastIndexOf('/'));
  const file = partPath.slice(partPath.lastIndexOf('/') + 1);
  const xml = await pkg.part(`${dir}/_rels/${file}.rels`);
  const rels: Rels = new Map();
  if (!xml) return rels;
  for (const rel of Array.from(parseXml(xml).getElementsByTagName('Relationship'))) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target) rels.set(id, target);
  }
  return rels;
}

/** A relationship target resolved against the part that declared it. */
function resolveTarget(target: string, fromDir: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = `${fromDir}/${target}`.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '.' || p === '') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

// ── Numbering ────────────────────────────────────────────────────────────────

interface ListStyle { ordered: boolean; styleType: string }

/**
 * `numId` → what the list looks like.
 *
 * Two hops, because a `w:num` is an instance of a `w:abstractNum` and it is the
 * abstract definition that holds the format. Only level 0 is read: the editor's
 * model has one style per list, and Word's nine levels collapse into it.
 */
async function readNumbering(pkg: Package): Promise<Map<string, ListStyle>> {
  const out = new Map<string, ListStyle>();
  const xml = await pkg.part('word/numbering.xml');
  if (!xml) return out;
  const doc = parseXml(xml);
  const root = doc.documentElement;

  const abstract = new Map<string, ListStyle>();
  for (const an of kids(root, 'abstractNum')) {
    const id = attr(an, 'abstractNumId');
    const lvl0 = kids(an, 'lvl').find((l) => attr(l, 'ilvl') === '0') ?? kid(an, 'lvl');
    if (!id || !lvl0) continue;
    const fmt = wval(kid(lvl0, 'numFmt')) ?? 'decimal';
    if (fmt === 'bullet') {
      const glyph = wval(kid(lvl0, 'lvlText')) ?? '●';
      abstract.set(id, { ordered: false, styleType: GLYPH_TO_BULLET[glyph] ?? 'disc' });
    } else {
      abstract.set(id, { ordered: true, styleType: NUMFMT_TO_ORDERED_STYLE[fmt] ?? 'decimal' });
    }
  }

  for (const num of kids(root, 'num')) {
    const numId = attr(num, 'numId');
    const absId = wval(kid(num, 'abstractNumId'));
    if (!numId || absId === null) continue;
    const style = abstract.get(absId);
    if (style) out.set(numId, style);
  }
  return out;
}

// ── Footnotes ────────────────────────────────────────────────────────────────

async function readFootnotes(pkg: Package): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const xml = await pkg.part('word/footnotes.xml');
  if (!xml) return out;
  for (const fn of kids(parseXml(xml).documentElement, 'footnote')) {
    const id = attr(fn, 'id');
    // Word reserves ids 0 and -1 for the separator marks; they are not notes.
    if (!id || Number(id) < 1) continue;
    out.set(id, kids(fn, 'p').map(paragraphPlainText).join('\n').trim());
  }
  return out;
}

function paragraphPlainText(p: Element): string {
  let text = '';
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (child.localName === 't' || child.localName === 'delText') text += child.textContent ?? '';
      else if (child.localName === 'tab') text += '\t';
      else walk(child);
    }
  };
  walk(p);
  return text;
}

// ── Runs and marks ───────────────────────────────────────────────────────────

/** `w:rPr` → the marks that produced it. */
function marksFromRunProps(rPr: Element | null): DocMark[] {
  if (!rPr) return [];
  const marks: DocMark[] = [];

  for (const [ooxmlName, markName] of Object.entries(OOXML_TO_TOGGLE_MARK)) {
    const el = kid(rPr, ooxmlName);
    if (!el) continue;
    // `w:u` is not a toggle — it names an underline style, and `none` means off.
    if (ooxmlName === 'u') {
      if ((wval(el) ?? 'single') !== 'none') marks.push({ type: markName });
      continue;
    }
    if (toggleOn(el)) marks.push({ type: markName });
  }

  const vert = wval(kid(rPr, 'vertAlign'));
  if (vert === 'superscript') marks.push({ type: 'superscript' });
  if (vert === 'subscript') marks.push({ type: 'subscript' });

  if (wval(kid(rPr, 'rStyle')) === CODE_STYLE_ID) marks.push({ type: 'code' });

  const textStyle: Record<string, string> = {};
  const color = ooxmlToHex(wval(kid(rPr, 'color')));
  if (color) textStyle.color = color;
  const sz = wval(kid(rPr, 'sz'));
  if (sz && Number(sz) > 0) textStyle.fontSize = halfPointsToFontSize(Number(sz));
  const fonts = kid(rPr, 'rFonts');
  const family = attr(fonts, 'ascii') ?? attr(fonts, 'hAnsi');
  if (family) textStyle.fontFamily = family;
  if (Object.keys(textStyle).length) marks.push({ type: 'textStyle', attrs: textStyle });

  // A highlight is either the closed enumeration or, for a colour outside it,
  // run shading — `write.ts` picks whichever fits and both come back here.
  const highlight = wval(kid(rPr, 'highlight'));
  if (highlight && highlight !== 'none') {
    marks.push({ type: 'highlight', attrs: { color: NAME_TO_HIGHLIGHT[highlight] ?? highlight } });
  } else {
    const shdFill = ooxmlToHex(attr(kid(rPr, 'shd'), 'fill'));
    if (shdFill && shdFill !== '#ffffff') marks.push({ type: 'highlight', attrs: { color: shdFill } });
  }

  return marks;
}

interface ReadContext {
  numbering: Map<string, ListStyle>;
  footnotes: Map<string, string>;
  extras: DocExtras;
  rels: Rels;
  media: Map<string, string>;
  counters: Record<string, number>;
}

const nextIndex = (ctx: ReadContext, kind: string): number => {
  const n = ctx.counters[kind] ?? 0;
  ctx.counters[kind] = n + 1;
  return n;
};

/** Inline children of a paragraph, in order. */
function inlineFrom(parent: Element, ctx: ReadContext, extraMarks: DocMark[] = []): DocNode[] {
  const out: DocNode[] = [];

  const pushText = (text: string, marks: DocMark[]) => {
    if (!text) return;
    const last = out[out.length - 1];
    // Adjacent runs with identical marks are one text node in the model, and
    // Word splits runs freely (a spell-check pass alone will do it). Without
    // this, a round trip fragments every paragraph a little more each time.
    if (last?.type === 'text' && sameMarks(last.marks, marks)) {
      last.text = (last.text ?? '') + text;
      return;
    }
    out.push(marks.length ? { type: 'text', text, marks } : { type: 'text', text });
  };

  for (const el of Array.from(parent.children)) {
    switch (el.localName) {
      case 'r': {
        const rPr = kid(el, 'rPr');
        const marks = [...marksFromRunProps(rPr), ...extraMarks];
        // A placeholder run is kept as a node of its own rather than as text,
        // so it cannot merge into an adjacent italic run and lose the shape
        // `restorePlaceholders` matches on. See `PLACEHOLDER_STYLE_ID`.
        const placeholder = wval(kid(rPr, 'rStyle')) === PLACEHOLDER_STYLE_ID;
        for (const child of Array.from(el.children)) {
          switch (child.localName) {
            case 't':
            case 'delText':
              if (placeholder) out.push({ type: '__placeholder', text: child.textContent ?? '' });
              else pushText(child.textContent ?? '', marks);
              break;
            case 'tab':
              pushText('\t', marks);
              break;
            case 'br':
              if (attr(child, 'type') === 'page') out.push({ type: '__pageBreak' });
              else out.push({ type: 'hardBreak' });
              break;
            case 'footnoteReference': {
              const id = attr(child, 'id') ?? '';
              out.push({ type: 'footnote', attrs: { id: `fn-${id}`, text: ctx.footnotes.get(id) ?? '' } });
              break;
            }
            case 'drawing':
              out.push(imageFrom(child, ctx));
              break;
            default:
              break;
          }
        }
        break;
      }

      case 'hyperlink': {
        const relId = attr(el, 'id', R);
        const href = relId ? ctx.rels.get(relId) ?? '' : `#${attr(el, 'anchor') ?? ''}`;
        for (const node of inlineFrom(el, ctx, extraMarks)) {
          if (node.type === 'text') {
            node.marks = [
              ...(node.marks ?? []).filter((m) => m.type !== 'textStyle' || true),
              { type: 'link', attrs: { href } },
            ];
          }
          out.push(node);
        }
        break;
      }

      case 'ins':
      case 'del': {
        const type = el.localName === 'ins' ? 'trackedInsertion' : 'trackedDeletion';
        const author = attr(el, 'author') ?? null;
        out.push(...inlineFrom(el, ctx, [...extraMarks, { type, attrs: { author } }]));
        break;
      }

      case 'fldSimple':
        out.push(fieldFrom(el, ctx));
        break;

      case 'bookmarkStart':
      case 'bookmarkEnd':
      case 'proofErr':
        break;

      default:
        // Something the mapping does not model — a content control, a smart
        // tag. Its runs are still content, so descend rather than drop it.
        if (el.children.length) out.push(...inlineFrom(el, ctx, extraMarks));
        break;
    }
  }
  return out;
}

function sameMarks(a: DocMark[] | undefined, b: DocMark[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

/**
 * A `w:fldSimple` back to what it came from.
 *
 * A `REF` field is a cross-reference: the mark goes back on the field's cached
 * result, which `write.ts` stores precisely so the text survives. Everything
 * else is a `docField`.
 */
function fieldFrom(el: Element, ctx: ReadContext): DocNode {
  const instr = (attr(el, 'instr') ?? '').trim();
  const cached = inlineFrom(el, ctx).map((n) => n.text ?? '').join('');

  if (instr.startsWith('REF ')) {
    const index = nextIndex(ctx, 'crossRef');
    const headingText = ctx.extras.crossRefs?.[index] ?? '';
    return { type: 'text', text: cached, marks: [{ type: 'crossRef', attrs: { headingText } }] };
  }

  const index = nextIndex(ctx, 'docField');
  const showCode = ctx.extras.fieldShowCode?.includes(index) ?? false;
  const docProp = /^DOCPROPERTY\s+(.+)$/i.exec(instr);
  if (docProp) {
    return { type: 'docField', attrs: { code: 'custom', arg: docProp[1].trim(), showCode } };
  }
  const code = INSTRUCTION_TO_FIELD[instr.split(/\s+/)[0]] ?? 'title';
  return { type: 'docField', attrs: { code, arg: null, showCode } };
}

/** A `w:drawing` back to an image node, with its extras reapplied. */
function imageFrom(el: Element, ctx: ReadContext): DocNode {
  const index = nextIndex(ctx, 'image');
  const extra = ctx.extras.images?.[index] ?? {};

  const blip = el.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'blip')[0]
    ?? el.getElementsByTagName('a:blip')[0];
  const relId = blip ? blip.getAttributeNS(R, 'embed') ?? blip.getAttribute('r:embed') : null;
  const media = relId ? ctx.media.get(relId) : undefined;

  const ext = el.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent')[0]
    ?? el.getElementsByTagName('wp:extent')[0];
  const cx = ext?.getAttribute('cx');

  const attrs: Record<string, unknown> = {
    // The Drive reference wins over the embedded bytes: it is what the editor
    // stores, and re-inlining a resolved image would turn a reference into a
    // multi-megabyte data URL on every open.
    src: extra.driveRef ?? media ?? '',
  };
  if (cx) attrs.width = String(Math.round(Number(cx) / 9525));
  if (extra.shadow) attrs.shadow = extra.shadow;
  if (extra.filter) attrs.imageFilter = extra.filter;
  if (extra.caption) attrs.caption = extra.caption;
  return { type: 'image', attrs };
}

// ── Paragraphs and blocks ────────────────────────────────────────────────────

interface ParsedBlock {
  node: DocNode;
  /** Set when the paragraph belonged to a list, so blocks can be regrouped. */
  list?: { numId: string; level: number };
}

function paragraphFrom(p: Element, ctx: ReadContext): ParsedBlock[] {
  const pPr = kid(p, 'pPr');
  const styleId = wval(kid(pPr, 'pStyle'));
  const content = inlineFrom(p, ctx);

  // A paragraph whose only content is a page break is a section break node,
  // not an empty paragraph containing one.
  const breaks = content.filter((n) => n.type === '__pageBreak');
  if (breaks.length && content.every((n) => n.type === '__pageBreak')) {
    return breaks.map(() => ({ node: { type: 'sectionBreak' } }));
  }
  const cleaned = content.filter((n) => n.type !== '__pageBreak');

  const attrs: Record<string, unknown> = {};
  const jc = wval(kid(pPr, 'jc'));
  if (jc && OOXML_TO_ALIGNMENT[jc]) attrs.textAlign = OOXML_TO_ALIGNMENT[jc];

  const indLeft = attr(kid(pPr, 'ind'), 'left');
  const numPr = kid(pPr, 'numPr');
  // Not read off a numbered paragraph: there, `w:ind` is the numbering level's
  // own indentation, which Word restates on every list paragraph. Reading it
  // would give every second-level bullet in every Word document an `indent` of
  // 2 on top of the nesting that already says so.
  if (indLeft && !numPr) {
    const level = Math.round(twipToPx(Number(indLeft)) / INDENT_PX_PER_LEVEL);
    if (level > 0) attrs.indent = level;
  }

  if (styleId === CODE_BLOCK_STYLE_ID) {
    const text = cleaned.map((n) => n.text ?? '').join('');
    return [{ node: { type: 'codeBlock', content: text ? [{ type: 'text', text }] : [] } }];
  }
  if (styleId === QUOTE_STYLE_ID) {
    return [{ node: { type: 'blockquote', content: [{ type: 'paragraph', attrs, content: cleaned }] } }];
  }

  const headingLevel = headingLevelFromStyle(styleId);
  const node: DocNode = headingLevel
    ? { type: 'heading', attrs: { ...attrs, level: headingLevel }, content: cleaned }
    : { type: 'paragraph', attrs, content: cleaned };

  const list = numPr
    ? { numId: wval(kid(numPr, 'numId')) ?? '', level: Number(wval(kid(numPr, 'ilvl')) ?? '0') }
    : undefined;

  return [{ node, list }];
}

function tableFrom(tbl: Element, ctx: ReadContext): DocNode {
  const rows = kids(tbl, 'tr').map((tr) => ({
    type: 'tableRow',
    content: kids(tr, 'tc').map((tc) => {
      const tcPr = kid(tc, 'tcPr');
      // Every attribute the cell node declares, present whether or not the
      // package said anything about it. `AdvancedTableCell` defaults all three
      // presentational ones to `null` and Tiptap serialises defaults, so a cell
      // with no fill is `backgroundColor: null` in the model — omitting the key
      // would make a plain cell read back as a different node from the one that
      // was written.
      const attrs: Record<string, unknown> = {
        colspan: Number(wval(kid(tcPr, 'gridSpan')) ?? '1'),
        rowspan: 1,
        colwidth: null as number[] | null,
        backgroundColor: null as string | null,
        borderColor: null as string | null,
        borderWidth: null as string | null,
      };
      const width = attr(kid(tcPr, 'tcW'), 'w');
      if (width && attr(kid(tcPr, 'tcW'), 'type') === 'dxa') {
        attrs.colwidth = [Math.round(twipToPx(Number(width)))];
      }
      const fill = ooxmlToHex(attr(kid(tcPr, 'shd'), 'fill'));
      if (fill) attrs.backgroundColor = fill;
      const borders = kid(tcPr, 'tcBorders');
      const top = kid(borders, 'top');
      if (top) {
        const color = ooxmlToHex(attr(top, 'color'));
        if (color) attrs.borderColor = color;
        const sz = attr(top, 'sz');
        if (sz) attrs.borderWidth = `${Number(sz) / 8}px`;
      }
      return { type: 'tableCell', attrs, content: blocksFrom(tc, ctx) };
    }),
  }));
  return { type: 'table', content: rows as DocNode[] };
}

/** Every block child of `parent`, with lists regrouped and extras reapplied. */
function blocksFrom(parent: Element, ctx: ReadContext): DocNode[] {
  const parsed: ParsedBlock[] = [];

  for (const el of Array.from(parent.children)) {
    switch (el.localName) {
      case 'p':
        parsed.push(...paragraphFrom(el, ctx));
        break;
      case 'tbl':
        parsed.push({ node: tableFrom(el, ctx) });
        break;
      case 'sdt': {
        // The only structured document tag the writer emits is the table of
        // contents; anything else is content some other editor wrapped, and
        // its blocks belong in the document either way.
        const alias = wval(kid(kid(el, 'sdtPr'), 'alias'));
        if (alias === 'Table of Contents') {
          parsed.push({ node: { type: 'tableOfContents' } });
        } else {
          const content = kid(el, 'sdtContent');
          if (content) parsed.push(...blocksFrom(content, ctx).map((node) => ({ node })));
        }
        break;
      }
      case 'sectPr':
      case 'bookmarkStart':
      case 'bookmarkEnd':
        break;
      default:
        break;
    }
  }

  return groupColumnLayouts(mergeQuotes(groupLists(parsed, ctx)), ctx);
}

/**
 * Consecutive quote paragraphs folded into one blockquote.
 *
 * Same shape of problem as lists: OOXML has no quote element, only paragraphs
 * carrying the quote style, so a three-paragraph quote arrives as three
 * one-paragraph quotes. Two blockquotes written back to back in the editor are
 * indistinguishable from one with two paragraphs by the time they are in the
 * package, so merging is the only answer either way — and it is the one that
 * keeps a quote from splintering a little more with every save.
 */
function mergeQuotes(blocks: DocNode[]): DocNode[] {
  const out: DocNode[] = [];
  for (const node of blocks) {
    const last = out[out.length - 1];
    if (node.type === 'blockquote' && last?.type === 'blockquote') {
      last.content = [...(last.content ?? []), ...(node.content ?? [])];
      continue;
    }
    out.push(node);
  }
  return out;
}

/**
 * Consecutive list paragraphs folded back into `bulletList`/`orderedList`.
 *
 * OOXML has no list element — a list is a run of paragraphs that happen to
 * share a numbering id — so this is where the shape the editor stores gets
 * rebuilt, including nesting, which is carried by `w:ilvl`.
 *
 * A sub-list is free to be a different *kind* of list from the one it sits in:
 * a numbered list under a bulleted one is ordinary, and each gets its own
 * numbering definition and so its own `w:numId`. So the run cannot end at the
 * first change of `w:numId` — a paragraph deeper than the run's own level
 * continues it whatever numbering it uses, and only a paragraph back at that
 * level under different numbering starts a new list.
 */
function groupLists(blocks: ParsedBlock[], ctx: ReadContext): DocNode[] {
  const out: DocNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (!block.list) {
      out.push(block.node);
      i++;
      continue;
    }
    const { numId, level: baseLevel } = block.list;
    const run: ParsedBlock[] = [];
    while (i < blocks.length && blocks[i].list) {
      const list = blocks[i].list!;
      if (list.level <= baseLevel && list.numId !== numId) break;
      run.push(blocks[i]);
      i++;
    }
    out.push(...buildLists(run, baseLevel, ctx));
  }
  return out;
}

/**
 * The lists a run of list paragraphs at `level` or deeper describes.
 *
 * Plural because one run can hold several sibling lists — a bulleted list
 * followed by a numbered one, both nested inside the same item — and because
 * returning them separately is what lets each take its style from its own
 * numbering definition rather than inheriting the outermost one.
 */
function buildLists(run: ParsedBlock[], level: number, ctx: ReadContext): DocNode[] {
  const out: DocNode[] = [];
  let i = 0;

  while (i < run.length) {
    const numId = run[i].list!.numId;
    const style = ctx.numbering.get(numId);
    const items: DocNode[] = [];

    while (i < run.length && run[i].list!.numId === numId && run[i].list!.level <= level) {
      const children: DocNode[] = [run[i].node];
      i++;
      // Anything deeper than this level belongs inside the item just added.
      const nested: ParsedBlock[] = [];
      while (i < run.length && (run[i].list?.level ?? 0) > level) {
        nested.push(run[i]);
        i++;
      }
      if (nested.length) children.push(...buildLists(nested, level + 1, ctx));
      items.push({ type: 'listItem', content: children });
    }

    if (items.length === 0) {
      // Only reachable from a document whose levels do not descend — a `w:ilvl`
      // of 3 with no 2 above it. Taking the paragraph as an item of its own
      // keeps it in the document and, more to the point, guarantees `i` moves.
      items.push({ type: 'listItem', content: [run[i].node] });
      i++;
    }

    out.push({
      type: style?.ordered ? 'orderedList' : 'bulletList',
      attrs: { listStyleType: style?.styleType ?? (style?.ordered ? 'decimal' : 'disc') },
      content: items,
    });
  }

  return out;
}

/**
 * Column layouts rebuilt from the extras.
 *
 * `write.ts` records how many blocks each layout covered because OOXML models
 * columns as a section property, not as a container — see the note there. A
 * document edited elsewhere will not match, and then the blocks stay where
 * they are, which is the right way for this to fail.
 */
function groupColumnLayouts(blocks: DocNode[], ctx: ReadContext): DocNode[] {
  const layouts = (ctx.extras as { columnLayouts?: { columns: number; blockCount: number }[] }).columnLayouts;
  if (!layouts?.length) return blocks;

  const out: DocNode[] = [];
  let i = 0;
  let layout = 0;
  while (i < blocks.length) {
    const spec = layouts[layout];
    if (spec && spec.blockCount > 0 && i + spec.blockCount <= blocks.length) {
      out.push({
        type: 'columnLayout',
        attrs: { columns: spec.columns },
        content: blocks.slice(i, i + spec.blockCount),
      });
      i += spec.blockCount;
      layout++;
      continue;
    }
    out.push(blocks[i]);
    i++;
  }
  return out;
}

// ── Section properties, headers and footers ──────────────────────────────────

function pageSetupFrom(sectPr: Element | null): PageSetup {
  if (!sectPr) return { ...DEFAULT_PAGE_SETUP };
  const sz = kid(sectPr, 'pgSz');
  const mar = kid(sectPr, 'pgMar');

  const w = Number(attr(sz, 'w') ?? 0);
  const h = Number(attr(sz, 'h') ?? 0);
  const orientAttr = attr(sz, 'orient');
  const orientation: PageSetup['orientation'] =
    orientAttr === 'landscape' || (!orientAttr && w > h) ? 'landscape' : 'portrait';

  const num = (name: string, fallback: number) => {
    const v = attr(mar, name);
    return v === null ? fallback : twipToPt(Number(v));
  };

  return {
    pageSize: pageSizeFromTwips(w, h) ?? DEFAULT_PAGE_SETUP.pageSize,
    orientation,
    marginTop: num('top', DEFAULT_PAGE_SETUP.marginTop),
    marginBottom: num('bottom', DEFAULT_PAGE_SETUP.marginBottom),
    marginLeft: num('left', DEFAULT_PAGE_SETUP.marginLeft),
    marginRight: num('right', DEFAULT_PAGE_SETUP.marginRight),
  };
}

const emptySlots = (): HeaderFooterSlots => ({ left: '', center: '', right: '' });
const emptyPair = () => ({ header: emptySlots(), footer: emptySlots() });

/**
 * A header or footer part back into three slots.
 *
 * The band was written as one paragraph with a centre and a right tab stop, so
 * splitting on tabs is what recovers the slots. A field goes back to the
 * `{{token}}` the editor writes it as.
 */
function bandFrom(doc: Document | null): HeaderFooterSlots {
  const slots = emptySlots();
  if (!doc) return slots;
  const p = kids(doc.documentElement, 'p')[0];
  if (!p) return slots;

  const parts: string[] = [''];
  const push = (s: string) => { parts[parts.length - 1] += s; };

  for (const el of Array.from(p.children)) {
    if (el.localName === 'fldSimple') {
      const instr = (attr(el, 'instr') ?? '').trim();
      const docProp = /^DOCPROPERTY\s+(.+)$/i.exec(instr);
      const code = docProp ? docProp[1].trim() : INSTRUCTION_TO_FIELD[instr.split(/\s+/)[0]];
      push(code ? `{{${code}}}` : '');
      continue;
    }
    if (el.localName !== 'r') continue;
    for (const child of Array.from(el.children)) {
      if (child.localName === 'tab') parts.push('');
      else if (child.localName === 't') push(child.textContent ?? '');
    }
  }

  slots.left = parts[0] ?? '';
  slots.center = parts[1] ?? '';
  slots.right = parts[2] ?? '';
  return slots;
}

async function readBands(
  pkg: Package,
  sectPr: Element | null,
  rels: Rels,
): Promise<{ config: HeaderFooterConfig; watermark: string }> {
  const config: HeaderFooterConfig = {
    differentFirstPage: toggleOn(kid(sectPr, 'titlePg')),
    differentEvenOdd: false,
    headerMargin: twipToPt(Number(attr(kid(sectPr, 'pgMar'), 'header') ?? 720)),
    footerMargin: twipToPt(Number(attr(kid(sectPr, 'pgMar'), 'footer') ?? 720)),
    variants: { default: emptyPair(), first: emptyPair(), even: emptyPair() },
  };

  const settings = await pkg.part('word/settings.xml');
  if (settings) {
    config.differentEvenOdd = toggleOn(kid(parseXml(settings).documentElement, 'evenAndOddHeaders'));
  }

  let watermark = '';
  const typeToVariant: Record<string, HeaderFooterVariant> = {
    default: 'default', first: 'first', even: 'even',
  };

  for (const [tag, slot] of [['headerReference', 'header'], ['footerReference', 'footer']] as const) {
    for (const ref of kids(sectPr, tag)) {
      const variant = typeToVariant[attr(ref, 'type') ?? 'default'];
      const relId = attr(ref, 'id', R);
      const target = relId ? rels.get(relId) : null;
      if (!variant || !target) continue;
      const xml = await pkg.part(resolveTarget(target, 'word'));
      if (!xml) continue;
      const parsed = parseXml(xml);
      config.variants[variant][slot] = bandFrom(parsed);
      if (slot === 'header' && !watermark) {
        const textpath = parsed.getElementsByTagName('v:textpath')[0]
          ?? parsed.getElementsByTagName('textpath')[0];
        watermark = textpath?.getAttribute('string') ?? '';
      }
    }
  }

  return { config, watermark };
}

// ── Document properties ──────────────────────────────────────────────────────

async function readProperties(pkg: Package): Promise<LayoutMeta['properties']> {
  const props = emptyDocProperties();
  const core = await pkg.part('docProps/core.xml');
  if (core) {
    const doc = parseXml(core);
    const text = (tag: string) => doc.getElementsByTagName(tag)[0]?.textContent ?? '';
    props.author = text('dc:creator') || text('creator');
    props.subject = text('dc:subject') || text('subject');
    props.keywords = text('cp:keywords') || text('keywords');
    props.category = text('dc:description') || text('description');
  }
  const custom = await pkg.part('docProps/custom.xml');
  if (custom) {
    for (const p of Array.from(parseXml(custom).getElementsByTagName('property'))) {
      const name = p.getAttribute('name');
      const value = p.firstElementChild?.textContent ?? '';
      if (!name) continue;
      if (name === 'company') props.company = value;
      else if (name === 'manager') props.manager = value;
      else props.custom[name] = value;
    }
  }
  return props;
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * `bytes` as the document model.
 *
 * Never throws for a document it only partly understands: an unreadable part
 * yields its default rather than aborting the read, because the alternative —
 * refusing to open a document because its `numbering.xml` is unusual — is
 * worse than opening it with plain bullets.
 */
export async function readDocx(bytes: Uint8Array): Promise<DocModel> {
  const pkg = await openPackage(bytes);

  const documentXml = await pkg.part('word/document.xml');
  if (!documentXml) throw new Error('not-a-docx');

  const rels = await readRels(pkg, 'word/document.xml');
  const extras = await readExtras(pkg);

  const media = new Map<string, string>();
  for (const [id, target] of rels) {
    if (!/^(\.\.\/)?media\//.test(target)) continue;
    const path = resolveTarget(target, 'word');
    const data = await pkg.bytes(path);
    if (data) media.set(id, toDataUrl(path, data));
  }

  const ctx: ReadContext = {
    numbering: await readNumbering(pkg),
    footnotes: await readFootnotes(pkg),
    extras,
    rels,
    media,
    counters: {},
  };

  const doc = parseXml(documentXml);
  const body = kid(doc.documentElement, 'body');
  const content = body ? blocksFrom(body, ctx) : [];
  const sectPr = kid(body, 'sectPr');

  const { config, watermark } = await readBands(pkg, sectPr, rels);
  const background = doc.documentElement
    ? ooxmlToHex(attr(kid(doc.documentElement, 'background'), 'color'))
    : '';

  const meta: LayoutMeta = {
    headerFooter: config,
    headerText: config.variants.default.header.center,
    footerText: config.variants.default.footer.center,
    showPageNumbers: /\{\{page\}\}/.test(
      config.variants.default.footer.center + config.variants.default.header.right,
    ),
    watermarkText: watermark,
    bgColor: background,
    docTheme: (extras.theme ?? 'default') as LayoutMeta['docTheme'],
    properties: await readProperties(pkg),
    pageSetup: pageSetupFrom(sectPr),
  };

  // Placeholders last: these are inline nodes the writer had to replace with
  // text, and they are matched back by position.
  restorePlaceholders(content, extras, { at: 0 });

  return { doc: { type: 'doc', content }, meta };
}

/**
 * Placeholder runs turned back into the nodes they stood in for.
 *
 * The writer emits `[Title]` in the placeholder character style for the three
 * nodes OOXML cannot carry — a sheet embed, a diagram embed, and an image whose
 * Drive reference could not be resolved to bytes. All three go into one ordered
 * list in the extras, and are matched back in document order, because the
 * placeholders are indistinguishable from each other in the document itself.
 *
 * A document edited elsewhere will have placeholders that no longer line up.
 * Whatever is left over stays as the italic text it looks like, which is
 * legible and wrong in an obvious way — better than restoring an embed onto a
 * paragraph that has nothing to do with it.
 */
function restorePlaceholders(
  nodes: DocNode[],
  extras: DocExtras,
  cursor: { at: number },
): void {
  const list = extras.placeholders ?? [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const entry = list[cursor.at];

    // A block placeholder was given a paragraph to itself, so the paragraph is
    // what stands in for the node and the paragraph is what gets replaced.
    if (entry && BLOCK_PLACEHOLDER_KINDS.has(entry.kind)
      && node.type === 'paragraph' && node.content?.length === 1
      && node.content[0].type === '__placeholder') {
      nodes[i] = { type: entry.kind, attrs: entry.attrs };
      cursor.at++;
      continue;
    }

    if (node.type === '__placeholder') {
      nodes[i] = entry
        ? { type: entry.kind, attrs: entry.attrs }
        // No extras entry to match: the run stays as what it reads as.
        : { type: 'text', text: node.text ?? '', marks: [{ type: 'italic' }] };
      if (entry) cursor.at++;
      continue;
    }

    if (node.content) restorePlaceholders(node.content, extras, cursor);
  }
}

async function readExtras(pkg: Package): Promise<DocExtras> {
  const xml = await pkg.part(EXTRAS_PART);
  if (!xml) return {};
  try {
    const text = parseXml(xml).documentElement?.textContent ?? '';
    return text ? (JSON.parse(text) as DocExtras) : {};
  } catch {
    return {};
  }
}

function toDataUrl(path: string, data: Uint8Array): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const mime = ext === 'png' ? 'image/png'
    : ext === 'gif' ? 'image/gif'
    : ext === 'svg' ? 'image/svg+xml'
    : 'image/jpeg';
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return `data:${mime};base64,${btoa(binary)}`;
}
