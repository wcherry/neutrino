/**
 * HTML → the Tiptap JSON a Neutrino document stores.
 *
 * A Google Docs document leaves Takeout as a file, not as JSON: `.docx` by
 * default, or `.html`/`.txt` when the export was configured that way. The
 * `.docx` half is handled by mammoth (`docxToHtml` in `importDocs.ts`), which
 * gives back plain semantic HTML; this module does the second half, turning
 * that HTML into the ProseMirror document the docs editor reads back.
 *
 * It is written by hand rather than driven off the editor's schema for the
 * same reason `inlineHtml.ts` is: the import runs nowhere near a Tiptap
 * instance, and pulling `DocEditor`'s extension list in — feature flags,
 * collaboration, spell check and all — just to parse HTML would drag the whole
 * editor into the import bundle. What it emits is the intersection every
 * configuration of that editor understands: the StarterKit nodes plus tables,
 * images, links, and the bold/italic/underline/strike/code/highlight/textStyle
 * marks. Nodes behind a feature flag (footnotes, columns, section breaks) are
 * never emitted, so an imported document opens the same with the flags on or
 * off.
 *
 * Two known limits, both by design:
 *
 *  - Formatting Google expressed as CSS classes rather than inline styles —
 *    which is what its HTML export does, `<span class="c3">` plus a `<style>`
 *    block — is not resolved, so an HTML export keeps its text and structure
 *    but loses bold/italic. The `.docx` path (the Takeout default) does not
 *    have this problem: mammoth emits `<strong>` and `<em>`.
 *  - Images arrive as data URIs from mammoth and are embedded as-is, so an
 *    image-heavy document converts to a correspondingly large body.
 */

export interface PmMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  marks?: PmMark[];
  text?: string;
}

// ── Tag tables ────────────────────────────────────────────────────────────────

const BOLD_TAGS = new Set(['B', 'STRONG']);
const ITALIC_TAGS = new Set(['I', 'EM']);
const UNDERLINE_TAGS = new Set(['U', 'INS']);
const STRIKE_TAGS = new Set(['S', 'STRIKE', 'DEL']);
const CODE_TAGS = new Set(['CODE', 'TT', 'KBD', 'SAMP']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'HEAD', 'NOSCRIPT']);

/** Containers whose children are blocks in their own right, not content. */
const TRANSPARENT_TAGS = new Set([
  'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'FIGURE', 'FORM', 'BODY',
]);

const HEADING_LEVELS: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };

const BLOCK_TAGS = new Set([
  'P', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE', 'DL', 'DT', 'DD',
  ...Object.keys(HEADING_LEVELS),
  ...TRANSPARENT_TAGS,
]);

const BOLD_STYLE = /font-weight\s*:\s*(bold(er)?|[6-9]00)\b/i;
const ITALIC_STYLE = /font-style\s*:\s*italic\b/i;
const UNDERLINE_STYLE = /text-decoration[^:]*:[^;]*underline/i;
const STRIKE_STYLE = /text-decoration[^:]*:[^;]*line-through/i;
const COLOR_STYLE = /(?:^|;)\s*color\s*:\s*([^;]+)/i;
const BACKGROUND_STYLE = /background(?:-color)?\s*:\s*([^;]+)/i;
const ALIGN_STYLE = /text-align\s*:\s*(left|center|right|justify)/i;

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

// ── Marks ─────────────────────────────────────────────────────────────────────

function withMark(marks: PmMark[], type: string): PmMark[] {
  return marks.some((m) => m.type === type) ? marks : [...marks, { type }];
}

/**
 * Add or extend the `textStyle` mark, which is the one mark that carries
 * attributes from several sources at once (colour and font family both live
 * on it), so a second attribute must not replace the first.
 */
function withTextStyle(marks: PmMark[], attrs: Record<string, unknown>): PmMark[] {
  const existing = marks.find((m) => m.type === 'textStyle');
  if (existing) {
    existing.attrs = { ...existing.attrs, ...attrs };
    return marks;
  }
  return [...marks, { type: 'textStyle', attrs }];
}

/** The marks an inline element contributes on top of the ones it inherits. */
function marksFor(el: Element, inherited: PmMark[]): PmMark[] {
  const tag = el.tagName.toUpperCase();
  // A fresh array per element: `withTextStyle` mutates the mark it finds, and
  // sibling elements must not see each other's attributes.
  let marks = inherited.map((m) => ({ ...m }));

  if (CODE_TAGS.has(tag)) {
    // Code is exclusive: `**bold**` inside a code span is literal text there.
    return withMark(marks, 'code');
  }
  if (BOLD_TAGS.has(tag)) marks = withMark(marks, 'bold');
  if (ITALIC_TAGS.has(tag)) marks = withMark(marks, 'italic');
  if (UNDERLINE_TAGS.has(tag)) marks = withMark(marks, 'underline');
  if (STRIKE_TAGS.has(tag)) marks = withMark(marks, 'strike');
  if (tag === 'MARK') marks = withMark(marks, 'highlight');
  if (tag === 'SUP' || tag === 'SUB') {
    // Superscript/subscript are behind `docsAdvancedFormatting`, so the mark
    // may not exist in the schema the reader builds. The characters survive
    // either way, which is what matters for a footnote marker.
    return marks;
  }

  const style = el.getAttribute('style') ?? '';
  if (!style) return marks;

  if (BOLD_STYLE.test(style)) marks = withMark(marks, 'bold');
  if (ITALIC_STYLE.test(style)) marks = withMark(marks, 'italic');
  if (UNDERLINE_STYLE.test(style)) marks = withMark(marks, 'underline');
  if (STRIKE_STYLE.test(style)) marks = withMark(marks, 'strike');

  const color = COLOR_STYLE.exec(style)?.[1]?.trim();
  if (color) marks = withTextStyle(marks, { color });

  const background = BACKGROUND_STYLE.exec(style)?.[1]?.trim();
  // `transparent`/`none` is Word's way of saying "no highlight at all".
  if (background && !/^(transparent|none|inherit)$/i.test(background)) {
    marks = withMark(marks, 'highlight');
    const highlight = marks.find((m) => m.type === 'highlight')!;
    highlight.attrs = { ...highlight.attrs, color: background };
  }

  return marks;
}

// ── Inline content ────────────────────────────────────────────────────────────

function textNode(text: string, marks: PmMark[]): PmNode {
  return marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text };
}

function collectInline(node: Node, marks: PmMark[], out: PmNode[]): void {
  if (node.nodeType === TEXT_NODE) {
    // HTML source newlines and indentation are formatting, not content; a real
    // line break arrived as <br> and is a hardBreak node by the time we're here.
    const text = (node.nodeValue ?? '').replace(/\s+/g, ' ');
    if (text) out.push(textNode(text, marks));
    return;
  }
  if (node.nodeType !== ELEMENT_NODE) return;

  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (SKIP_TAGS.has(tag)) return;

  if (tag === 'BR') {
    out.push({ type: 'hardBreak' });
    return;
  }

  if (tag === 'IMG') {
    const src = el.getAttribute('src')?.trim();
    if (!src) return;
    const attrs: Record<string, unknown> = { src };
    const alt = el.getAttribute('alt');
    const title = el.getAttribute('title');
    if (alt) attrs.alt = alt;
    if (title) attrs.title = title;
    out.push({ type: 'image', attrs });
    return;
  }

  if (tag === 'A') {
    const href = el.getAttribute('href')?.trim();
    const inner = href ? [...marks, { type: 'link', attrs: { href } }] : marks;
    for (const child of Array.from(el.childNodes)) collectInline(child, inner, out);
    return;
  }

  const inner = marksFor(el, marks);
  for (const child of Array.from(el.childNodes)) collectInline(child, inner, out);
}

/**
 * Tidy a run of inline nodes for use as a block's content.
 *
 * Leading and trailing whitespace is an artefact of the markup's own layout —
 * `<p>\n  Hello\n</p>` is the word alone — so it goes, and a run left with
 * nothing in it produces no block at all.
 */
function tidyInline(nodes: PmNode[]): PmNode[] {
  const out = nodes.slice();
  while (out.length > 0 && isBlank(out[0])) out.shift();
  while (out.length > 0 && isBlank(out[out.length - 1])) out.pop();
  if (out.length === 0) return out;

  const first = out[0];
  if (first.type === 'text') first.text = first.text!.replace(/^ +/, '');
  const last = out[out.length - 1];
  if (last.type === 'text') last.text = last.text!.replace(/ +$/, '');

  return out.filter((n) => n.type !== 'text' || n.text !== '');
}

function isBlank(node: PmNode): boolean {
  if (node.type === 'hardBreak') return true;
  return node.type === 'text' && !node.text?.trim();
}

// ── Block content ─────────────────────────────────────────────────────────────

function alignAttrs(el: Element): Record<string, unknown> | undefined {
  const style = el.getAttribute('style') ?? '';
  const align = ALIGN_STYLE.exec(style)?.[1] ?? el.getAttribute('align');
  if (!align) return undefined;
  const value = align.toLowerCase();
  if (value === 'left' || value === 'center' || value === 'right' || value === 'justify') {
    return { textAlign: value };
  }
  return undefined;
}

function paragraph(content: PmNode[], attrs?: Record<string, unknown>): PmNode {
  const node: PmNode = { type: 'paragraph' };
  if (attrs) node.attrs = attrs;
  if (content.length > 0) node.content = content;
  return node;
}

/** Inline children of `el`, as the content of a single block node. */
function inlineOf(el: Element): PmNode[] {
  const out: PmNode[] = [];
  for (const child of Array.from(el.childNodes)) collectInline(child, [], out);
  return tidyInline(out);
}

/**
 * The blocks inside a container, grouping stretches of inline content into
 * paragraphs of their own — HTML lets text sit directly in a `<li>` or a
 * `<td>`, but ProseMirror needs a block to put it in.
 */
function blocksOf(el: Element): PmNode[] {
  const out: PmNode[] = [];
  let inline: PmNode[] = [];

  const flush = () => {
    const content = tidyInline(inline);
    inline = [];
    if (content.length > 0) out.push(paragraph(content));
  };

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === ELEMENT_NODE && BLOCK_TAGS.has((child as Element).tagName.toUpperCase())) {
      flush();
      out.push(...blockFor(child as Element));
    } else {
      collectInline(child, [], inline);
    }
  }
  flush();

  return out;
}

/** Blocks for a container, guaranteeing at least one — an empty cell needs a paragraph. */
function blocksOrEmpty(el: Element): PmNode[] {
  const blocks = blocksOf(el);
  return blocks.length > 0 ? blocks : [paragraph([])];
}

function listItems(el: Element): PmNode[] {
  const items: PmNode[] = [];
  for (const child of Array.from(el.children)) {
    if (child.tagName.toUpperCase() !== 'LI') continue;
    items.push({ type: 'listItem', content: blocksOrEmpty(child) });
  }
  return items;
}

/** The `<tr>`s of a table, whether or not they sit in a thead/tbody/tfoot. */
function rowElements(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of Array.from(table.children)) {
    const tag = child.tagName.toUpperCase();
    if (tag === 'TR') rows.push(child);
    else if (tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT') {
      for (const grandchild of Array.from(child.children)) {
        if (grandchild.tagName.toUpperCase() === 'TR') rows.push(grandchild);
      }
    }
  }
  return rows;
}

function tableRows(el: Element): PmNode[] {
  const rows: PmNode[] = [];
  for (const tr of rowElements(el)) {
    const cells: PmNode[] = [];
    for (const cell of Array.from(tr.children)) {
      const tag = cell.tagName.toUpperCase();
      if (tag !== 'TD' && tag !== 'TH') continue;
      const attrs: Record<string, unknown> = { colspan: spanOf(cell, 'colspan'), rowspan: spanOf(cell, 'rowspan'), colwidth: null };
      cells.push({ type: tag === 'TH' ? 'tableHeader' : 'tableCell', attrs, content: blocksOrEmpty(cell) });
    }
    if (cells.length > 0) rows.push({ type: 'tableRow', content: cells });
  }
  return rows;
}

function spanOf(cell: Element, attr: string): number {
  const raw = Number.parseInt(cell.getAttribute(attr) ?? '', 10);
  return Number.isFinite(raw) && raw > 1 ? raw : 1;
}

function blockFor(el: Element): PmNode[] {
  const tag = el.tagName.toUpperCase();

  if (SKIP_TAGS.has(tag)) return [];

  const level = HEADING_LEVELS[tag];
  if (level) {
    const content = inlineOf(el);
    if (content.length === 0) return [];
    return [{ type: 'heading', attrs: { level, ...alignAttrs(el) }, content }];
  }

  switch (tag) {
    case 'P':
    case 'DT':
    case 'DD':
      // An empty paragraph is spacing the author put there deliberately, so
      // unlike a whitespace-only run between blocks it is kept.
      return [paragraph(inlineOf(el), alignAttrs(el))];

    case 'UL': {
      const items = listItems(el);
      return items.length > 0 ? [{ type: 'bulletList', content: items }] : [];
    }

    case 'OL': {
      const items = listItems(el);
      if (items.length === 0) return [];
      const start = Number.parseInt(el.getAttribute('start') ?? '', 10);
      const attrs = Number.isFinite(start) && start !== 1 ? { start } : undefined;
      return [attrs ? { type: 'orderedList', attrs, content: items } : { type: 'orderedList', content: items }];
    }

    // A stray <li> outside any list — its text still belongs in the document.
    case 'LI':
      return blocksOrEmpty(el);

    case 'BLOCKQUOTE':
      return [{ type: 'blockquote', content: blocksOrEmpty(el) }];

    case 'PRE': {
      // Whitespace is the content in a code block, so this is the one place
      // the source text is taken verbatim.
      const text = (el.textContent ?? '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
      return [text ? { type: 'codeBlock', content: [{ type: 'text', text }] } : { type: 'codeBlock' }];
    }

    case 'HR':
      return [{ type: 'horizontalRule' }];

    case 'TABLE': {
      const rows = tableRows(el);
      return rows.length > 0 ? [{ type: 'table', content: rows }] : [];
    }

    default:
      // DIV and friends: pass through to whatever they wrap.
      return blocksOf(el);
  }
}

// ── Entry points ──────────────────────────────────────────────────────────────

const EMPTY_DOC: PmNode = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * Convert a document's HTML into the Tiptap JSON the docs editor stores.
 *
 * Never throws: markup this cannot parse yields an empty document rather than
 * failing the whole import run.
 */
export function htmlToDocJson(html: string): PmNode {
  if (!html.trim()) return EMPTY_DOC;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return EMPTY_DOC;
  }
  if (!doc.body) return EMPTY_DOC;

  const content = blocksOf(doc.body);
  // The editor always needs a block to put the cursor in.
  return content.length > 0 ? { type: 'doc', content } : EMPTY_DOC;
}

/** Convert a plain-text export (`.txt`) into the same JSON, a line per paragraph. */
export function textToDocJson(text: string): PmNode {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  // A trailing newline is how the file ends, not an empty last paragraph.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();

  const content = lines.map((line) => paragraph(line ? [{ type: 'text', text: line }] : []));
  return content.length > 0 ? { type: 'doc', content } : EMPTY_DOC;
}
