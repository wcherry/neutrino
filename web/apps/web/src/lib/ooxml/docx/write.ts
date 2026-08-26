/**
 * Neutrino's document model → a real `.docx`.
 *
 * Everything the editor can hold is written as the OOXML element that means
 * it: page setup as `w:sectPr`, header and footer bands as `word/header*.xml`
 * with `w:titlePg`/`w:evenAndOddHeaders`, footnotes as `word/footnotes.xml`,
 * field codes as `w:fldSimple`, the table of contents as a `TOC` field,
 * cross-references as bookmarks and `REF` fields, tracked changes as
 * `w:ins`/`w:del`, document properties as `docProps/core.xml` and
 * `docProps/custom.xml`. Word does not see an approximation of the document;
 * it sees the document.
 *
 * The four things OOXML has no way to express — the two embed nodes, Drive
 * image references, and the theme name — plus a few presentational attributes
 * go into the custom XML part described in `mapping.ts`.
 *
 * Read this together with `read.ts`: they are two halves of one mapping and
 * `__tests__/ooxml/docxRoundTrip.test.ts` asserts they agree. A change here
 * that has no counterpart there is a change that loses data.
 */

import type { PageSetup } from '@neutrino/api-docs';
import type { LayoutMeta } from '@/lib/docBody';
import type { HeaderFooterSlots, HeaderFooterVariant } from '@/lib/docHeaderFooter';
import {
  ALIGNMENT_TO_OOXML, BULLET_GLYPH, CODE_BLOCK_STYLE_ID, CODE_STYLE_ID,
  EXTRAS_NAMESPACE, EXTRAS_PART, EXTRAS_PROPS_PART, FIELD_TO_INSTRUCTION, HIGHLIGHT_NAMES,
  INDENT_PX_PER_LEVEL, ORDERED_STYLE_TO_NUMFMT, PAGE_SIZE_TWIPS,
  PLACEHOLDER_STYLE_ID, QUOTE_STYLE_ID,
  docPropertyInstruction, fontSizeToHalfPoints, hexToOoxml, headingStyleId,
  normalizeColor, ptToTwip, pxToTwip,
  type DocExtras, type DocMark, type DocModel, type DocNode,
} from './mapping';

// The `docx` package is ~400KB; it is only needed when a document is saved or
// exported, so the module is imported at that point rather than with the
// editor. The *types* are imported normally — they erase at build time, and
// having them is what stops this file drifting into `unknown` casts that would
// hide a wrong option name until Word refused to open the result.
import type {
  ICharacterStyleOptions, IParagraphStyleOptions, IRunOptions,
  FileChild, ParagraphChild, ITableCellOptions,
} from 'docx';

type Docx = typeof import('docx');

/**
 * Run properties, as the library spells them.
 *
 * `-readonly` because these are accumulated a mark at a time; the library's own
 * options are frozen, which is right for a value being passed in and wrong for
 * one being built up.
 */
type RunStyle = {
  -readonly [K in
    'bold' | 'italics' | 'underline' | 'strike' | 'color' | 'size' | 'font'
    | 'highlight' | 'shading' | 'superScript' | 'subScript' | 'style'
  ]?: IRunOptions[K];
};

// ── Extras collection ────────────────────────────────────────────────────────

/**
 * Counts nodes as they are written so the extras part can address them by
 * document order — see `DocExtras` for why order rather than id.
 */
class ExtrasCollector {
  readonly extras: DocExtras = {};
  private counters: Record<string, number> = {};

  next(kind: string): number {
    const n = this.counters[kind] ?? 0;
    this.counters[kind] = n + 1;
    return n;
  }

  image(index: number, data: NonNullable<DocExtras['images']>[number]): void {
    if (Object.keys(data).length === 0) return;
    (this.extras.images ??= {})[index] = data;
  }

  crossRef(index: number, headingText: string): void {
    (this.extras.crossRefs ??= {})[index] = headingText;
  }

  /** An inline node written as a text placeholder — see `DocExtras`. */
  placeholder(kind: string, attrs: Record<string, unknown>): void {
    (this.extras.placeholders ??= []).push({ kind, attrs });
  }

  fieldShowCode(index: number): void {
    (this.extras.fieldShowCode ??= []).push(index);
  }
}

// ── Run properties ───────────────────────────────────────────────────────────

/**
 * Marks on a text node collapsed into the run properties that express them.
 *
 * `highlight` is the one that needs a decision: OOXML's `w:highlight` is a
 * closed sixteen-colour list, so a highlight that is not one of them is
 * written as run shading (`w:shd`) instead, which takes any colour. Both come
 * back as a highlight mark on the way in.
 */
function runStyleFor(marks: DocMark[] | undefined, d: Docx): RunStyle {
  const style: RunStyle = {};
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold': style.bold = true; break;
      case 'italic': style.italics = true; break;
      case 'underline': style.underline = {}; break;
      case 'strike': style.strike = true; break;
      case 'superscript': style.superScript = true; break;
      case 'subscript': style.subScript = true; break;
      case 'code': style.style = CODE_STYLE_ID; break;
      case 'highlight': {
        const hex = normalizeColor(mark.attrs?.color as string);
        const name = HIGHLIGHT_NAMES[hex];
        if (name) style.highlight = name;
        else if (hex) style.shading = { type: d.ShadingType.CLEAR, fill: hexToOoxml(hex) };
        break;
      }
      case 'textStyle': {
        const color = normalizeColor(mark.attrs?.color as string);
        if (color) style.color = hexToOoxml(color);
        const size = fontSizeToHalfPoints(mark.attrs?.fontSize as string);
        if (size) style.size = size;
        const family = mark.attrs?.fontFamily as string | undefined;
        if (family) style.font = family;
        break;
      }
      default: break;
    }
  }
  return style;
}

const hasMark = (marks: DocMark[] | undefined, type: string): DocMark | undefined =>
  (marks ?? []).find((m) => m.type === type);

// ── Inline content ───────────────────────────────────────────────────────────

/**
 * One paragraph's children.
 *
 * Tracked insertions and deletions become `w:ins`/`w:del` runs — Word's own
 * revision marks, so a suggestion made in Neutrino is a suggestion Word can
 * accept or reject. Both carry the author and a date, which OOXML requires.
 */
function inlineChildren(
  nodes: DocNode[] | undefined,
  d: Docx,
  ctx: WriteContext,
): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const node of nodes ?? []) {
    switch (node.type) {
      case 'text': {
        out.push(...textRuns(node, d, ctx));
        break;
      }
      case 'hardBreak':
        out.push(new d.TextRun({ break: 1 }));
        break;
      case 'image':
        out.push(imageRun(node, d, ctx));
        break;
      case 'footnote': {
        const id = ctx.footnoteNumberFor(node);
        out.push(new d.FootnoteReferenceRun(id));
        break;
      }
      case 'docField':
        out.push(fieldRun(node, d, ctx));
        break;
      case 'sheetEmbed':
      case 'diagramEmbed':
        out.push(...embedRuns(node, d, ctx));
        break;
      default:
        // An inline node the mapping does not know. Its text still belongs in
        // the document — dropping it silently is the failure mode this whole
        // module exists to avoid.
        if (node.content) out.push(...inlineChildren(node.content, d, ctx));
        break;
    }
  }
  return out;
}

/**
 * A text node as one or more runs.
 *
 * Three of the marks a run can carry are not run properties in OOXML but
 * elements that *contain* the run — `w:hyperlink` for a link, `w:ins`/`w:del`
 * for a tracked change, `w:fldSimple` for a cross-reference. They nest, and the
 * nesting order is the one Word writes: the hyperlink outermost, since a link
 * is a property of the text's position in the document rather than of the
 * revision that put it there.
 */
function textRuns(node: DocNode, d: Docx, ctx: WriteContext): ParagraphChild[] {
  const style = runStyleFor(node.marks, d);
  const text = node.text ?? '';

  const link = hasMark(node.marks, 'link');
  const crossRef = hasMark(node.marks, 'crossRef');
  const inserted = hasMark(node.marks, 'trackedInsertion');
  const deleted = hasMark(node.marks, 'trackedDeletion');
  // The library styles hyperlink text by name, and the name has to be on the
  // run inside the `w:hyperlink`, whatever kind of run that turns out to be.
  const linked: RunStyle = link ? { ...style, style: 'Hyperlink' } : style;

  let run: ParagraphChild;
  if (crossRef) {
    const index = ctx.extras.next('crossRef');
    ctx.extras.crossRef(index, String(crossRef.attrs?.headingText ?? ''));
    // A REF field pointed at the bookmark the matching heading carries. Word
    // resolves and updates it; Neutrino restores the mark from the extras.
    // The cached result matters: a field with none loses the text the
    // reference was written on until Word is asked to update fields, and on
    // the way back in there would be nothing to put the mark on.
    run = new d.SimpleField(
      `REF ${ctx.bookmarkFor(String(crossRef.attrs?.headingText ?? ''))} \\h`,
      text,
    );
  } else if (inserted || deleted) {
    const revision = {
      id: ctx.nextRevisionId(),
      author: String((inserted ?? deleted)!.attrs?.author ?? 'Unknown'),
      date: ctx.revisionDate,
    };
    run = deleted
      ? new d.DeletedTextRun({ ...linked, text, ...revision })
      : new d.InsertedTextRun({ ...linked, text, ...revision });
  } else {
    run = new d.TextRun({ ...linked, text });
  }

  if (!link) return [run];
  return [new d.ExternalHyperlink({
    link: String(link.attrs?.href ?? ''),
    children: [run as never],
  })];
}

/** A `docField` node as a real Word field, so it stays live in Word. */
function fieldRun(node: DocNode, d: Docx, ctx: WriteContext): ParagraphChild {
  const code = String(node.attrs?.code ?? 'title');
  const arg = node.attrs?.arg as string | undefined;
  const index = ctx.extras.next('docField');
  if (node.attrs?.showCode === true) ctx.extras.fieldShowCode(index);

  const instruction = code === 'custom' && arg
    ? docPropertyInstruction(arg)
    : FIELD_TO_INSTRUCTION[code] ?? docPropertyInstruction(arg ?? code);
  return new d.SimpleField(instruction);
}

/**
 * An embed as the only thing OOXML can honestly carry: its title as text,
 * hyperlinked back to the document it points at.
 *
 * A sheet or diagram embed is a live view onto another Drive file. Word has no
 * such concept — an OLE object would be a dead snapshot pretending otherwise —
 * so what goes into the document is a legible placeholder, and the embed's
 * attributes ride in the extras part where Neutrino picks them back up intact.
 */
function embedRuns(node: DocNode, d: Docx, ctx: WriteContext): ParagraphChild[] {
  ctx.extras.placeholder(node.type, node.attrs ?? {});
  const label = String(node.attrs?.title ?? (node.type === 'sheetEmbed' ? 'Embedded sheet' : 'Embedded diagram'));
  return [new d.TextRun({ text: `[${label}]`, italics: true, style: PLACEHOLDER_STYLE_ID })];
}

/**
 * An image as a real `w:drawing`.
 *
 * A `neutrino-drive:` reference cannot travel — it names a file in this Drive —
 * so the caller resolves it to bytes before we get here (`resolveImage`), and
 * the reference itself is kept in the extras so reopening in Neutrino restores
 * a reference rather than a multi-megabyte inline copy.
 */
/**
 * The image format `bytes` are in, read from their own leading bytes.
 *
 * The format decides the extension and content type of the media part the
 * library writes, so guessing wrong puts JPEG bytes in `image1.png`. Word
 * sniffs and renders it anyway; strict consumers (and OOXML validators) do not.
 * The `src` cannot answer this — a Drive reference has no extension and a
 * resolved data URL's mime type is whatever the uploader claimed.
 */
function sniffImageType(bytes: Uint8Array): 'png' | 'jpg' | 'gif' | 'bmp' {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  return 'png';
}

function imageRun(node: DocNode, d: Docx, ctx: WriteContext): ParagraphChild {
  const src = String(node.attrs?.src ?? '');
  const bytes = ctx.images.get(src);

  if (!bytes) {
    // The caller could not resolve the image — a `neutrino-drive:` reference
    // exported from a session that could not reach Drive, most often. It goes
    // out as a placeholder carrying its whole attribute set, so reopening in
    // Neutrino restores the image node rather than a line of italic text. It
    // deliberately does *not* consume an image index: the reader counts those
    // off `w:drawing` elements, and an entry with no drawing behind it would
    // shift every later image's extras onto the wrong picture.
    ctx.extras.placeholder('image', node.attrs ?? {});
    return new d.TextRun({
      text: node.attrs?.caption ? `[${node.attrs.caption}]` : '[image]',
      italics: true,
      style: PLACEHOLDER_STYLE_ID,
    });
  }

  const index = ctx.extras.next('image');
  const width = parseFloat(String(node.attrs?.width ?? '')) || 480;
  const height = Math.round(width * 0.6);

  const attrs = node.attrs ?? {};
  ctx.extras.image(index, {
    shadow: attrs.shadow && attrs.shadow !== 'none' ? String(attrs.shadow) : undefined,
    filter: attrs.imageFilter && attrs.imageFilter !== 'none' ? String(attrs.imageFilter) : undefined,
    caption: attrs.caption ? String(attrs.caption) : undefined,
    driveRef: src.startsWith('neutrino-drive:') ? src : undefined,
  });

  const alt = node.attrs?.alt ? String(node.attrs.alt) : '';
  return new d.ImageRun({
    type: sniffImageType(bytes),
    data: bytes,
    transformation: { width, height },
    ...(alt ? { altText: { name: alt, description: alt, title: alt } } : {}),
  });
}

// ── Block content ────────────────────────────────────────────────────────────

function alignmentOf(node: DocNode, d: Docx): (typeof d.AlignmentType)[keyof typeof d.AlignmentType] | undefined {
  const align = node.attrs?.textAlign as keyof typeof ALIGNMENT_TO_OOXML | undefined;
  if (!align || !(align in ALIGNMENT_TO_OOXML)) return undefined;
  return { left: d.AlignmentType.LEFT, center: d.AlignmentType.CENTER,
    right: d.AlignmentType.RIGHT, justify: d.AlignmentType.JUSTIFIED }[align];
}

function indentOf(node: DocNode): { left: number } | undefined {
  const level = Number(node.attrs?.indent ?? 0);
  return level > 0 ? { left: pxToTwip(level * INDENT_PX_PER_LEVEL) } : undefined;
}

/** One block node as the docx elements that mean it. */
function blockNode(node: DocNode, d: Docx, ctx: WriteContext, list?: ListContext): FileChild[] {
  switch (node.type) {
    case 'paragraph':
      return [new d.Paragraph({
        alignment: alignmentOf(node, d),
        // Inside a list the indentation belongs to the numbering level, which
        // already sets `w:ind` for it. Writing our own on top would override
        // it — a level-2 item indented back to where level 1 sits — so the
        // level wins and an explicit indent on a list paragraph is not carried.
        // `read.ts` declines to read `w:ind` off a numbered paragraph for the
        // same reason, from the other side.
        indent: list ? undefined : indentOf(node),
        numbering: list,
        children: inlineChildren(node.content, d, ctx),
      })];

    case 'heading': {
      const level = Number(node.attrs?.level ?? 1);
      const text = plainText(node);
      // A bookmark on every heading is what makes REF cross-references
      // resolvable in Word; `bookmarkFor` hands out the same name to the
      // reference that points at it.
      return [new d.Paragraph({
        style: headingStyleId(level),
        alignment: alignmentOf(node, d),
        indent: indentOf(node),
        children: [
          new d.Bookmark({ id: ctx.bookmarkFor(text), children: inlineChildren(node.content, d, ctx) as never[] }),
        ],
      })];
    }

    case 'bulletList':
    case 'orderedList':
      return listBlocks(node, d, ctx);

    case 'blockquote':
      // OOXML has no quote element; a quote is paragraphs carrying the quote
      // style, which is where the left rule and the base indent come from. Only
      // paragraphs take it — a list inside a quote is still a list, and putting
      // a paragraph style on it would lose the numbering.
      return (node.content ?? []).flatMap((child) => (child.type === 'paragraph'
        ? [new d.Paragraph({
            style: QUOTE_STYLE_ID,
            alignment: alignmentOf(child, d),
            indent: indentOf(child),
            children: inlineChildren(child.content, d, ctx),
          })]
        : blockNode(child, d, ctx)));

    case 'codeBlock':
      return [new d.Paragraph({
        style: CODE_BLOCK_STYLE_ID,
        children: [new d.TextRun({ text: plainText(node) })],
      })];

    case 'sheetEmbed':
    case 'diagramEmbed':
      // Both are block nodes in the editor's schema, so the placeholder gets a
      // paragraph of its own — `restorePlaceholders` replaces that paragraph
      // rather than its contents, which is what keeps a block node out of an
      // inline position on the way back.
      return [new d.Paragraph({ children: embedRuns(node, d, ctx) })];

    case 'horizontalRule':
      return [new d.Paragraph({ thematicBreak: true, children: [] })];

    case 'sectionBreak':
      return [new d.Paragraph({ children: [new d.PageBreak()] })];

    case 'tableOfContents':
      // A real TOC field: Word offers to update it, and it comes back as this
      // node rather than as the frozen list of headings it happened to show.
      return [new d.TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-6' })];

    case 'columnLayout': {
      // CSS columns are a section-level concept in OOXML. Writing them as a
      // real continuous section (`w:cols`) means splitting the body into
      // sections, which is the right mapping and the one to move to; until
      // then the children are written in order and the node's shape — column
      // count and how many blocks it covered — is recorded in the extras,
      // which is what `read.ts` regroups from.
      const blocks = (node.content ?? []).flatMap((child) => blockNode(child, d, ctx));
      ctx.columnLayouts.push({ columns: Number(node.attrs?.columns ?? 2), blockCount: blocks.length });
      return blocks;
    }

    case 'table':
      return [tableNode(node, d, ctx)];

    case 'image':
      return [new d.Paragraph({ children: [imageRun(node, d, ctx)] })];

    default:
      // Unknown block: keep its text rather than dropping the node.
      return [new d.Paragraph({ children: inlineChildren(node.content, d, ctx) })];
  }
}

interface ListContext { reference: string; level: number }

/**
 * A list as paragraphs bound to a numbering definition.
 *
 * Each distinct list style gets its own `w:num`, because the glyph for a
 * bullet and the format for an ordered list are properties of the numbering
 * definition rather than of the paragraph.
 */
function listBlocks(node: DocNode, d: Docx, ctx: WriteContext, level = 0): FileChild[] {
  const ordered = node.type === 'orderedList';
  const styleType = String(node.attrs?.listStyleType ?? (ordered ? 'decimal' : 'disc'));
  const reference = ctx.numberingFor(ordered, styleType);

  const out: FileChild[] = [];
  for (const item of node.content ?? []) {
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        out.push(...listBlocks(child, d, ctx, level + 1));
      } else {
        out.push(...blockNode(child, d, ctx, { reference, level }));
      }
    }
  }
  return out;
}

function tableNode(node: DocNode, d: Docx, ctx: WriteContext): FileChild {
  const rows = (node.content ?? []).map((row) => new d.TableRow({
    children: (row.content ?? []).map((cell) => {
      const bg = normalizeColor(cell.attrs?.backgroundColor as string);
      const borderColor = normalizeColor(cell.attrs?.borderColor as string);
      const borderWidth = parseFloat(String(cell.attrs?.borderWidth ?? '')) || undefined;
      const widths = cell.attrs?.colwidth as number[] | null | undefined;
      const border = borderColor || borderWidth
        ? {
            top: { style: d.BorderStyle.SINGLE, size: (borderWidth ?? 1) * 8, color: hexToOoxml(borderColor || '#000000') },
            bottom: { style: d.BorderStyle.SINGLE, size: (borderWidth ?? 1) * 8, color: hexToOoxml(borderColor || '#000000') },
            left: { style: d.BorderStyle.SINGLE, size: (borderWidth ?? 1) * 8, color: hexToOoxml(borderColor || '#000000') },
            right: { style: d.BorderStyle.SINGLE, size: (borderWidth ?? 1) * 8, color: hexToOoxml(borderColor || '#000000') },
          }
        : undefined;
      return new d.TableCell({
        columnSpan: Number(cell.attrs?.colspan ?? 1) || undefined,
        rowSpan: Number(cell.attrs?.rowspan ?? 1) || undefined,
        width: widths?.[0] ? { size: pxToTwip(widths[0]), type: d.WidthType.DXA } : undefined,
        shading: bg ? { type: d.ShadingType.CLEAR, fill: hexToOoxml(bg) } : undefined,
        borders: border,
        children: (cell.content ?? []).flatMap((c) => blockNode(c, d, ctx)),
      } as ITableCellOptions);
    }),
  }));
  return new d.Table({ width: { size: 100, type: d.WidthType.PERCENTAGE }, rows });
}

/** Every text node under `node`, concatenated. */
function plainText(node: DocNode): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(plainText).join('');
}

// ── Header / footer bands ────────────────────────────────────────────────────

/**
 * One band as a single centre-tabbed paragraph.
 *
 * The three slots are laid out with tab stops rather than a table, which is
 * how Word's own header styles do it: a centre tab at the middle of the text
 * width and a right tab at its end, so `left⇥centre⇥right` lands where the
 * editor draws it.
 */
function bandParagraph(slots: HeaderFooterSlots, d: Docx, ctx: WriteContext, widthTwips: number): FileChild {
  const children: ParagraphChild[] = [];
  const push = (text: string) => {
    for (const part of splitFields(text)) {
      children.push(part.field
        ? new d.SimpleField(part.field)
        : new d.TextRun({ text: part.text }));
    }
  };
  // A tab is a run child (`w:r/w:tab`), never a paragraph child. Emitting it
  // at paragraph level produces XML Word rejects outright.
  const tab = () => children.push(new d.TextRun({ children: [new d.Tab()] }));
  push(slots.left);
  if (slots.center || slots.right) tab();
  push(slots.center);
  if (slots.right) tab();
  push(slots.right);

  return new d.Paragraph({
    tabStops: [
      { type: d.TabStopType.CENTER, position: Math.round(widthTwips / 2) },
      { type: d.TabStopType.RIGHT, position: widthTwips },
    ],
    children,
  });
}

/**
 * Band text split into literal runs and field instructions.
 *
 * `{{page}}` in a footer has to become a `PAGE` field, not the text "1" — a
 * footer that says 1 on every page is the classic symptom of exporting the
 * resolved value instead of the field.
 */
export function splitFields(text: string): { text: string; field?: string }[] {
  const out: { text: string; field?: string }[] = [];
  const re = /\{\{(\w+)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    const instruction = FIELD_TO_INSTRUCTION[m[1]] ?? docPropertyInstruction(m[1]);
    out.push({ text: '', field: instruction });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const bandHasContent = (s: HeaderFooterSlots): boolean =>
  Boolean(s.left || s.center || s.right);

// ── Write context ────────────────────────────────────────────────────────────

interface WriteContext {
  extras: ExtrasCollector;
  images: Map<string, Uint8Array>;
  footnoteBodies: Map<number, string>;
  bookmarkFor(headingText: string): string;
  footnoteNumberFor(node: DocNode): number;
  numberingFor(ordered: boolean, styleType: string): string;
  nextRevisionId(): number;
  revisionDate: string;
  numberingConfigs: { reference: string; levels: unknown[] }[];
  /** Column layouts in document order, with how many blocks each covered. */
  columnLayouts: { columns: number; blockCount: number }[];
}

/** Options the caller supplies that the model itself cannot carry. */
export interface WriteDocxOptions {
  /** Document title, which is also what the `TITLE` field resolves to. */
  title: string;
  /**
   * Bytes for each image `src` in the document. A `neutrino-drive:` reference
   * must be resolved by the caller — this module cannot reach Drive, and an
   * unresolved reference is written as a placeholder rather than as a broken
   * image.
   */
  images?: Map<string, Uint8Array>;
  /** Fixed timestamp for revision marks, so a write is deterministic in tests. */
  revisionDate?: string;
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * `model` as `.docx` bytes.
 *
 * The extras part is attached afterwards by `attachExtras`, because the `docx`
 * package builds the package itself and has no hook for adding one.
 */
export async function writeDocx(model: DocModel, opts: WriteDocxOptions): Promise<Uint8Array> {
  const d = await import('docx');
  const { doc, meta } = model;

  const bookmarks = new Map<string, string>();
  const footnoteNumbers = new Map<DocNode, number>();
  const footnoteBodies = new Map<number, string>();
  const numbering = new Map<string, string>();
  let revisionId = 0;

  const ctx: WriteContext = {
    extras: new ExtrasCollector(),
    images: opts.images ?? new Map(),
    footnoteBodies,
    revisionDate: opts.revisionDate ?? '2000-01-01T00:00:00Z',
    numberingConfigs: [],
    columnLayouts: [],
    bookmarkFor(headingText) {
      const key = headingText.trim() || '_top';
      let name = bookmarks.get(key);
      if (!name) {
        name = `_Nx${bookmarks.size}`;
        bookmarks.set(key, name);
      }
      return name;
    },
    footnoteNumberFor(node) {
      let n = footnoteNumbers.get(node);
      if (!n) {
        n = footnoteNumbers.size + 1;
        footnoteNumbers.set(node, n);
        footnoteBodies.set(n, String(node.attrs?.text ?? ''));
      }
      return n;
    },
    numberingFor(ordered, styleType) {
      const key = `${ordered ? 'o' : 'b'}:${styleType}`;
      const existing = numbering.get(key);
      if (existing) return existing;
      const reference = `nx-list-${numbering.size}`;
      numbering.set(key, reference);
      ctx.numberingConfigs.push({
        reference,
        levels: Array.from({ length: 5 }, (_, level) => ({
          level,
          format: ordered ? (ORDERED_STYLE_TO_NUMFMT[styleType] ?? 'decimal') : 'bullet',
          text: ordered ? `%${level + 1}.` : (BULLET_GLYPH[styleType] ?? '●'),
          alignment: 'left',
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      });
      return reference;
    },
    nextRevisionId: () => ++revisionId,
  };

  // Body first: writing it is what discovers the footnotes, bookmarks,
  // numbering definitions and extras that the document properties below need.
  const body = (doc.content ?? []).flatMap((node) => blockNode(node, d, ctx));

  collectExtras(meta, ctx);

  const ps = meta.pageSetup;
  const landscape = ps.orientation === 'landscape';
  const size = PAGE_SIZE_TWIPS[ps.pageSize] ?? PAGE_SIZE_TWIPS.letter;
  const pageWidth = landscape ? size.h : size.w;
  const textWidth = pageWidth - ptToTwip(ps.marginLeft) - ptToTwip(ps.marginRight);

  const hf = meta.headerFooter;
  const variantMap: Record<HeaderFooterVariant, 'default' | 'first' | 'even'> = {
    default: 'default', first: 'first', even: 'even',
  };
  const headers: Record<string, unknown> = {};
  const footers: Record<string, unknown> = {};
  for (const [variant, key] of Object.entries(variantMap) as [HeaderFooterVariant, string][]) {
    const pair = hf?.variants?.[variant];
    if (!pair) continue;
    if (variant === 'first' && !hf.differentFirstPage) continue;
    if (variant === 'even' && !hf.differentEvenOdd) continue;
    if (bandHasContent(pair.header) || (variant === 'default' && meta.watermarkText)) {
      headers[key] = new d.Header({
        children: [
          ...(variant === 'default' && meta.watermarkText ? [watermarkParagraph(meta.watermarkText, d)] : []),
          bandParagraph(pair.header, d, ctx, textWidth),
        ] as never[],
      });
    }
    if (bandHasContent(pair.footer)) {
      footers[key] = new d.Footer({ children: [bandParagraph(pair.footer, d, ctx, textWidth)] as never[] });
    }
  }

  const footnotes: Record<number, { children: unknown[] }> = {};
  for (const [n, text] of footnoteBodies) {
    footnotes[n] = { children: [new d.Paragraph({ children: [new d.TextRun({ text })] })] };
  }

  const bgColor = normalizeColor(meta.bgColor);

  // `docProps/core.xml` has no element for company or manager, and none at all
  // for a user-defined property, so those go to `docProps/custom.xml` — which
  // is also where a `DOCPROPERTY` field looks for them, so a `{{custom:…}}`
  // field in the document resolves in Word rather than reading `!Undefined`.
  const props = meta.properties;
  const customProperties = [
    ...(props?.company ? [{ name: 'company', value: props.company }] : []),
    ...(props?.manager ? [{ name: 'manager', value: props.manager }] : []),
    ...Object.entries(props?.custom ?? {}).map(([name, value]) => ({ name, value: String(value) })),
  ];

  const document = new d.Document({
    // `''` rather than `undefined` for the author: the library substitutes
    // "Un-named" for a missing `creator`, which the parser would then read back
    // as the document's author — inventing one for every document that has
    // none, and a different one each time the account name is checked against
    // it.
    creator: meta.properties?.author ?? '',
    lastModifiedBy: meta.properties?.author ?? '',
    title: opts.title,
    subject: meta.properties?.subject || undefined,
    keywords: meta.properties?.keywords || undefined,
    description: meta.properties?.category || undefined,
    customProperties: customProperties.length ? customProperties : undefined,
    background: bgColor ? { color: hexToOoxml(bgColor) } : undefined,
    numbering: ctx.numberingConfigs.length
      ? { config: ctx.numberingConfigs as never[] }
      : undefined,
    styles: { paragraphStyles: paragraphStyles(d), characterStyles: characterStyles(d) },
    footnotes: Object.keys(footnotes).length ? (footnotes as never) : undefined,
    sections: [{
      properties: {
        page: {
          size: {
            orientation: landscape ? d.PageOrientation.LANDSCAPE : d.PageOrientation.PORTRAIT,
            width: size.w,
            height: size.h,
          },
          margin: {
            top: ptToTwip(ps.marginTop),
            bottom: ptToTwip(ps.marginBottom),
            left: ptToTwip(ps.marginLeft),
            right: ptToTwip(ps.marginRight),
            header: ptToTwip(hf?.headerMargin ?? 36),
            footer: ptToTwip(hf?.footerMargin ?? 36),
          },
        },
        titlePage: Boolean(hf?.differentFirstPage),
      },
      headers: headers as never,
      footers: footers as never,
      children: body,
    }],
    evenAndOddHeaderAndFooters: Boolean(hf?.differentEvenOdd),
  });

  const buffer = await d.Packer.toBuffer(document);
  return attachExtras(new Uint8Array(buffer), ctx.extras.extras);
}

/**
 * A watermark: Word draws one as a VML shape in the header, which is the one
 * construct the `docx` package has no builder for, so it goes in as raw XML.
 */
function watermarkParagraph(text: string, d: Docx): FileChild {
  // `ImportedXmlComponent` is the library's raw-XML escape hatch. It is a real
  // body child at runtime but is not declared as one, because the library
  // cannot know what XML it was handed — hence the assertion at the return.
  const xml = `
<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
     xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <w:r><w:pict>
    <v:shape id="NeutrinoWatermark" o:spid="_x0000_s2049" type="#_x0000_t136"
             style="position:absolute;margin-left:0;margin-top:0;width:468pt;height:117pt;
                    rotation:315;z-index:-251654144;mso-position-horizontal:center;
                    mso-position-horizontal-relative:margin;mso-position-vertical:center;
                    mso-position-vertical-relative:margin" fillcolor="#c0c0c0" stroked="f">
      <v:textpath style="font-family:&quot;Calibri&quot;;font-size:1pt" string="${escapeXml(text)}"/>
    </v:shape>
  </w:pict></w:r>
</w:p>`.trim();
  return d.ImportedXmlComponent.fromXmlString(xml) as unknown as FileChild;
}

function paragraphStyles(d: Docx): IParagraphStyleOptions[] {
  return [
    {
      id: QUOTE_STYLE_ID, name: 'Neutrino Quote', basedOn: 'Normal', next: 'Normal',
      run: { italics: true, color: '555555' },
      paragraph: { indent: { left: 720 }, spacing: { before: 120, after: 120 } },
    },
    {
      id: CODE_BLOCK_STYLE_ID, name: 'Neutrino Code Block', basedOn: 'Normal', next: 'Normal',
      // The tint is a run property: `w:pPr` has no shading, and putting one
      // there is silently dropped rather than rejected.
      run: { font: 'Consolas', size: 20, shading: { type: d.ShadingType.CLEAR, fill: 'F5F5F5' } },
      paragraph: { spacing: { before: 120, after: 120 } },
    },
  ];
}

function characterStyles(d: Docx): ICharacterStyleOptions[] {
  return [
    {
      id: CODE_STYLE_ID, name: 'Neutrino Code', basedOn: 'DefaultParagraphFont',
      run: { font: 'Consolas', shading: { type: d.ShadingType.CLEAR, fill: 'F5F5F5' } },
    },
    {
      // Italic, because that is how a placeholder should read in Word; a named
      // style, because that is how it is found again. See `PLACEHOLDER_STYLE_ID`.
      id: PLACEHOLDER_STYLE_ID, name: 'Neutrino Placeholder', basedOn: 'DefaultParagraphFont',
      run: { italics: true },
    },
  ];
}

// ── The extras part ──────────────────────────────────────────────────────────

/** Model data with no OOXML home, gathered once the body has been written. */
function collectExtras(meta: LayoutMeta, ctx: WriteContext): void {
  if (meta.docTheme && meta.docTheme !== 'default') ctx.extras.extras.theme = meta.docTheme;
  if (ctx.columnLayouts.length) {
    (ctx.extras.extras as Record<string, unknown>).columnLayouts = ctx.columnLayouts;
  }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
}

/**
 * Add the extras to a finished package as a custom XML part.
 *
 * Registered in `[Content_Types].xml` and related from the document, which is
 * what makes it a custom XML part rather than a stray file — the difference
 * that decides whether Word keeps it or throws it away on save.
 */
export async function attachExtras(pkg: Uint8Array, extras: DocExtras): Promise<Uint8Array> {
  if (Object.keys(extras).length === 0) return pkg;

  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(pkg);

  zip.file(EXTRAS_PART,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<neutrino xmlns="${EXTRAS_NAMESPACE}">${escapeXml(JSON.stringify(extras))}</neutrino>`);
  zip.file(EXTRAS_PROPS_PART,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ` +
    `ds:itemID="{4E4A2B37-7C21-4F1E-9C55-3F5B0E2A1D90}">` +
    `<ds:schemaRefs><ds:schemaRef ds:uri="${EXTRAS_NAMESPACE}"/></ds:schemaRefs></ds:datastoreItem>`);

  const ct = zip.file('[Content_Types].xml');
  if (ct) {
    let xml = await ct.async('string');
    if (!xml.includes(EXTRAS_PART)) {
      xml = xml.replace(/<\/Types>/,
        `<Override PartName="/${EXTRAS_PART}" ContentType="application/xml"/>` +
        `<Override PartName="/${EXTRAS_PROPS_PART}" ` +
        `ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>`);
      zip.file('[Content_Types].xml', xml);
    }
  }

  const rels = zip.file('word/_rels/document.xml.rels');
  if (rels) {
    let xml = await rels.async('string');
    if (!xml.includes('customXml')) {
      xml = xml.replace(/<\/Relationships>/,
        `<Relationship Id="rIdNeutrinoExtras" ` +
        `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" ` +
        `Target="../${EXTRAS_PART}"/></Relationships>`);
      zip.file('word/_rels/document.xml.rels', xml);
    }
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
