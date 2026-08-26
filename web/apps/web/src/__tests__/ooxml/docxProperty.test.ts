/**
 * `read(write(m)) === m` for documents nobody wrote by hand (issue #127).
 *
 * `docxRoundTrip.test.ts` asserts the same property over documents chosen by a
 * person, which is exactly the weakness: the cases a person picks are the cases
 * they were already thinking about. A mapping bug that only shows up when a
 * `crossRef` lands inside a list item, or when two adjacent runs differ only in
 * their font, survives every example anyone thought to write down.
 *
 * So this generates documents instead — several hundred nodes' worth per run,
 * from a seeded generator so a failure is reproducible from the seed printed
 * with it rather than being a flake that never recurs.
 *
 * ## What it generates, and what it deliberately does not
 *
 * The generator emits **canonical** models only: shapes where equality is the
 * right assertion, because the writer and parser both agree on one spelling of
 * them. What that rules out, and why:
 *
 *  - **Things OOXML cannot tell apart.** Two adjacent runs with identical
 *    marks are one run; two adjacent quotes are one quote; two adjacent lists
 *    of the same style are one list. The parser folds each of those back
 *    together, correctly, so the generator never produces the split form. That
 *    is not a limit of the round trip — it is what canonical means here.
 *  - **Resolvable images.** An image whose bytes are in the package comes back
 *    with the attribute set the parser reads off the drawing, not the one that
 *    went in. Generated images have no bytes, so they take the placeholder path
 *    and their attributes survive whole.
 *  - **Empty and whitespace-only text.** OOXML has no way to hold a run with no
 *    content, and the writer drops it.
 *  - **`indent` on a paragraph inside a list item.** In OOXML a list item's
 *    indentation is the numbering level's, and both halves defer to it rather
 *    than fight it, so an extra indent on top is not carried.
 *  - **Column layouts.** They are reconstructed from a recorded block count
 *    rather than from a real continuous section, which is a known gap noted in
 *    `write.ts`; the example tests cover what does work.
 *
 * Mark *order* is compared insensitively — see `normalized` for why that is a
 * weaker assertion in name only.
 */

import { describe, it, expect } from 'vitest';
import { writeDocx } from '@/lib/ooxml/docx/write';
import { readDocx } from '@/lib/ooxml/docx/read';
import type { DocModel, DocMark, DocNode } from '@/lib/ooxml/docx/mapping';
import type { LayoutMeta } from '@/lib/docBody';

// ---------------------------------------------------------------------------
// A seeded generator
// ---------------------------------------------------------------------------

/**
 * A 32-bit xorshift, not `Math.random`.
 *
 * A property test that fails once in fifty runs and cannot be re-run is worse
 * than no property test: it trains everyone to hit retry. Seeding means the
 * seed in the failure message reproduces the exact document.
 */
class Rng {
  private state: number;

  constructor(seed: number) {
    // 0 is a fixed point of xorshift, so it can never be the state.
    this.state = seed | 0 || 0x2545f491;
  }

  next(): number {
    let x = this.state;
    x ^= x << 13; x |= 0;
    x ^= x >>> 17;
    x ^= x << 5; x |= 0;
    this.state = x;
    return (x >>> 0) / 0x100000000;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}

const WORDS = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'the quick brown fox',
  'a sentence with spaces', 'Ampersand & angle < bracket >', 'quote "here"',
  'ünïcödé', '日本語のテキスト', 'emoji 🌍 too', "apostrophe's",
] as const;

const COLORS = ['#ff0000', '#00ff00', '#123456', '#abcdef', '#000000', '#fafafa'] as const;
const FONTS = ['Georgia', 'Arial', 'Times New Roman', 'Courier New'] as const;
const SIZES = ['9pt', '11pt', '13.5pt', '18pt', '24pt'] as const;
const BULLETS = ['disc', 'circle', 'square'] as const;
const ORDERED = ['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'] as const;
const ALIGN = ['left', 'center', 'right', 'justify'] as const;
const FIELD_CODES = ['page', 'pages', 'date', 'time', 'title', 'author', 'filename'] as const;

/** Marks that can be combined freely on one run. */
function marksFor(rng: Rng): DocMark[] | undefined {
  const marks: DocMark[] = [];
  for (const type of ['bold', 'italic', 'underline', 'strike']) {
    if (rng.chance(0.25)) marks.push({ type });
  }
  // Superscript and subscript are one `w:vertAlign` slot, so never both.
  if (rng.chance(0.1)) marks.push({ type: rng.chance(0.5) ? 'superscript' : 'subscript' });
  if (rng.chance(0.2)) {
    const attrs: Record<string, unknown> = {};
    if (rng.chance(0.7)) attrs.color = rng.pick(COLORS);
    if (rng.chance(0.7)) attrs.fontSize = rng.pick(SIZES);
    if (rng.chance(0.7)) attrs.fontFamily = rng.pick(FONTS);
    if (Object.keys(attrs).length > 0) marks.push({ type: 'textStyle', attrs });
  }
  if (rng.chance(0.12)) marks.push({ type: 'highlight', attrs: { color: rng.pick(COLORS) } });
  if (rng.chance(0.1)) marks.push({ type: 'link', attrs: { href: `https://example.com/${rng.int(99)}` } });
  if (rng.chance(0.08)) {
    marks.push({
      type: rng.chance(0.5) ? 'trackedInsertion' : 'trackedDeletion',
      attrs: { author: rng.pick(['Ada', 'Grace', 'Alan']) },
    });
  }
  return marks.length > 0 ? marks : undefined;
}

/** Two mark sets are the same run to OOXML, so the parser will merge them. */
const sameMarks = (a: DocMark[] | undefined, b: DocMark[] | undefined): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

interface Ctx {
  rng: Rng;
  /** Headings written so far — the only valid targets for a cross-reference. */
  headings: string[];
  footnoteId: number;
}

/**
 * A run of inline content.
 *
 * The `previous` bookkeeping is the whole subtlety: a text node whose marks
 * match the one before it is not a second node once it has been through OOXML.
 */
function inlineRun(ctx: Ctx, allowSpecial: boolean): DocNode[] {
  const { rng } = ctx;
  const out: DocNode[] = [];
  let previousMarks: DocMark[] | undefined;
  let previousWasText = false;

  const count = 1 + rng.int(4);
  for (let i = 0; i < count; i++) {
    if (allowSpecial && rng.chance(0.15)) {
      const kind = rng.int(4);
      if (kind === 0) {
        out.push({
          type: 'docField',
          attrs: { code: rng.pick(FIELD_CODES), arg: null, showCode: rng.chance(0.3) },
        });
      } else if (kind === 1) {
        out.push({ type: 'footnote', attrs: { id: `fn-${++ctx.footnoteId}`, text: rng.pick(WORDS) } });
      } else if (kind === 2) {
        out.push({ type: 'hardBreak' });
      } else {
        // No bytes are handed to the writer, so this takes the placeholder
        // path and its attributes come back verbatim.
        out.push({
          type: 'image',
          attrs: { src: `neutrino-drive:file-${rng.int(50)}`, width: String(120 + rng.int(400)) },
        });
      }
      previousWasText = false;
      continue;
    }

    let marks = marksFor(rng);
    // A cross-reference is a mark on its own — it becomes a `REF` field, which
    // cannot also carry the run properties of its neighbours.
    if (ctx.headings.length > 0 && rng.chance(0.08)) {
      marks = [{ type: 'crossRef', attrs: { headingText: rng.pick(ctx.headings) } }];
    }
    if (previousWasText && sameMarks(marks, previousMarks)) continue;

    out.push({ type: 'text', text: rng.pick(WORDS), ...(marks ? { marks } : {}) });
    previousMarks = marks;
    previousWasText = true;
  }

  // A paragraph of nothing but skipped runs would be empty, and an empty
  // paragraph is a different node from one whose runs all merged away.
  if (out.length === 0) out.push({ type: 'text', text: rng.pick(WORDS) });
  return out;
}

function paragraph(ctx: Ctx, allowSpecial = true, allowIndent = true): DocNode {
  const { rng } = ctx;
  const attrs: Record<string, unknown> = {};
  if (rng.chance(0.25)) attrs.textAlign = rng.pick(ALIGN);
  if (allowIndent && rng.chance(0.2)) attrs.indent = 1 + rng.int(4);
  return { type: 'paragraph', attrs, content: inlineRun(ctx, allowSpecial) };
}

function list(ctx: Ctx, depth: number): DocNode {
  const { rng } = ctx;
  const ordered = rng.chance(0.5);
  const items: DocNode[] = [];
  const count = 1 + rng.int(3);
  for (let i = 0; i < count; i++) {
    // No `indent`: inside a list, indentation is the numbering level's, and
    // both halves of the mapping defer to it — see `blockNode` in `write.ts`.
    const content: DocNode[] = [paragraph(ctx, true, false)];
    if (depth < 2 && rng.chance(0.25)) content.push(list(ctx, depth + 1));
    items.push({ type: 'listItem', content });
  }
  return {
    type: ordered ? 'orderedList' : 'bulletList',
    attrs: { listStyleType: ordered ? rng.pick(ORDERED) : rng.pick(BULLETS) },
    content: items,
  };
}

function table(ctx: Ctx): DocNode {
  const { rng } = ctx;
  const cols = 1 + rng.int(3);
  const rows: DocNode[] = [];
  for (let r = 0; r < 1 + rng.int(3); r++) {
    const cells: DocNode[] = [];
    for (let c = 0; c < cols; c++) {
      cells.push({
        type: 'tableCell',
        attrs: {
          colspan: 1,
          rowspan: 1,
          colwidth: null,
          backgroundColor: rng.chance(0.4) ? rng.pick(COLORS) : null,
          borderColor: null,
          borderWidth: null,
        },
        content: [paragraph(ctx, false)],
      });
    }
    rows.push({ type: 'tableRow', content: cells });
  }
  return { type: 'table', content: rows };
}

function block(ctx: Ctx): DocNode {
  const { rng } = ctx;
  const roll = rng.int(100);
  if (roll < 40) return paragraph(ctx);
  if (roll < 52) {
    const heading = rng.pick(WORDS) + ` ${ctx.headings.length}`;
    ctx.headings.push(heading);
    return { type: 'heading', attrs: { level: 1 + rng.int(6) }, content: [{ type: 'text', text: heading }] };
  }
  if (roll < 66) return list(ctx, 0);
  if (roll < 76) return table(ctx);
  if (roll < 84) {
    return {
      type: 'blockquote',
      content: Array.from({ length: 1 + rng.int(3) }, () => paragraph(ctx, false)),
    };
  }
  if (roll < 90) return { type: 'codeBlock', content: [{ type: 'text', text: rng.pick(WORDS) }] };
  if (roll < 94) return { type: 'sectionBreak' };
  if (roll < 97) return { type: 'tableOfContents' };
  return {
    type: 'sheetEmbed',
    attrs: { spreadsheetId: `s${rng.int(20)}`, title: rng.pick(WORDS) },
  };
}

const slots = (rng: Rng) => ({
  left: rng.chance(0.4) ? rng.pick(WORDS) : '',
  center: rng.chance(0.4) ? rng.pick(WORDS) : '',
  right: rng.chance(0.4) ? '{{date}}' : '',
});

const band = (rng: Rng) => ({ header: slots(rng), footer: slots(rng) });

function meta(rng: Rng): LayoutMeta {
  const variants = { default: band(rng), first: band(rng), even: band(rng) };
  const config = {
    differentFirstPage: rng.chance(0.3),
    differentEvenOdd: rng.chance(0.3),
    headerMargin: 18 + rng.int(60),
    footerMargin: 18 + rng.int(60),
    variants,
  };
  // A variant that is switched off is not written, so it cannot come back;
  // blanking it here is what the model would hold anyway.
  const blank = { header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' } };
  if (!config.differentFirstPage) variants.first = blank;
  if (!config.differentEvenOdd) variants.even = blank;

  return {
    headerFooter: config,
    // The flattened legacy view of the default variant. The parser derives
    // these from the bands rather than storing them, so the generator derives
    // them the same way; what is under test for them is that the derivation is
    // stable, not that three more fields survive a trip.
    headerText: variants.default.header.center,
    footerText: variants.default.footer.center,
    showPageNumbers: /\{\{page\}\}/.test(
      variants.default.footer.center + variants.default.header.right,
    ),
    watermarkText: rng.chance(0.3) ? rng.pick(['DRAFT', 'CONFIDENTIAL']) : '',
    bgColor: rng.chance(0.3) ? rng.pick(COLORS) : '',
    docTheme: rng.pick(['default', 'serif', 'modern']),
    properties: {
      author: rng.chance(0.5) ? 'Ada' : '',
      subject: rng.chance(0.5) ? rng.pick(WORDS) : '',
      company: rng.chance(0.3) ? 'Acme' : '',
      category: rng.chance(0.3) ? 'Notes' : '',
      keywords: rng.chance(0.3) ? 'a,b,c' : '',
      manager: rng.chance(0.3) ? 'Grace' : '',
      custom: rng.chance(0.3) ? { client: rng.pick(WORDS), ref: `R-${rng.int(999)}` } : {},
    },
    pageSetup: {
      pageSize: rng.pick(['letter', 'legal', 'tabloid', 'executive', 'a3', 'a4', 'a5']),
      orientation: rng.pick(['portrait', 'landscape']),
      marginTop: 18 + rng.int(90),
      marginBottom: 18 + rng.int(90),
      marginLeft: 18 + rng.int(90),
      marginRight: 18 + rng.int(90),
    },
  } as LayoutMeta;
}

/** Whether two neighbouring blocks of the same type are one block in OOXML. */
function mergesWithNeighbour(node: DocNode, last: DocNode): boolean {
  if (node.type === 'blockquote') return true;
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return node.attrs?.listStyleType === last.attrs?.listStyleType;
  }
  return false;
}

function generate(seed: number): DocModel {
  const rng = new Rng(seed);
  const ctx: Ctx = { rng, headings: [], footnoteId: 0 };
  // Headings first often enough that cross-references have something to point
  // at; a document of one paragraph exercises nothing.
  const content: DocNode[] = [];
  const blocks = 4 + rng.int(10);
  for (let i = 0; i < blocks; i++) {
    const node = block(ctx);
    // Two quotes back to back are one quote once they are paragraphs carrying
    // the quote style, and two lists of the same style back to back are one
    // list once they are paragraphs sharing a `w:numId`. Neither pair is
    // distinguishable in the package, so the parser merges them — merging here
    // too is what makes the generated model canonical rather than what makes
    // the test pass.
    const last = content[content.length - 1];
    if (last && node.type === last.type && mergesWithNeighbour(node, last)) {
      last.content = [...(last.content ?? []), ...(node.content ?? [])];
      continue;
    }
    content.push(node);
  }
  return { doc: { type: 'doc', content }, meta: meta(rng) };
}

// ---------------------------------------------------------------------------

/**
 * The same document with every node's marks in a fixed order.
 *
 * Mark *order* is not part of what a document is: ProseMirror reorders a
 * node's marks into schema order the moment `setContent` runs, so a parser
 * that returns `[link, bold]` where the editor stored `[bold, link]` has lost
 * nothing. Order in OOXML is genuinely different information — a link is an
 * element wrapping the run, a bold is a property inside it — so asking the two
 * to agree on a sequence would be asserting something neither format promises.
 */
function normalized(nodes: DocNode[]): DocNode[] {
  return nodes.map((node) => ({
    ...node,
    ...(node.marks ? { marks: [...node.marks].sort((a, b) => a.type.localeCompare(b.type)) } : {}),
    ...(node.content ? { content: normalized(node.content) } : {}),
  }));
}

/**
 * Seeds chosen once and pinned, so the suite is the same test every run.
 *
 * A hundred of them rather than a handful: a whole round trip is about 12ms, so
 * the coverage costs a second, and every bug this found — a numbered sub-list
 * under a bulleted one, a link inside a tracked deletion, a placeholder run
 * beside an italic one — needed a combination that a handful of documents would
 * have missed. Raise the count locally to hunt for more; nothing here depends
 * on the number.
 */
const SEEDS = Array.from({ length: 100 }, (_, i) => 1_000 + i * 7919);

describe('read(write(m)) === m over generated documents', () => {
  it.each(SEEDS)('seed %i', async (seed) => {
    const model = generate(seed);
    const out = await readDocx(await writeDocx(model, { title: 'Property', revisionDate: '2000-01-01T00:00:00Z' }));

    // Compared whole rather than field by field: a mapping that drops one
    // attribute is exactly the failure a per-field assertion talks itself out
    // of noticing.
    expect(normalized(out.doc.content ?? [])).toEqual(normalized(model.doc.content ?? []));
    expect(out.meta).toEqual(model.meta);
  });

  it('is deterministic — the same seed is the same document', () => {
    expect(generate(4242)).toEqual(generate(4242));
  });

  it('generates enough to be worth running', () => {
    const nodes = (n: DocNode): number =>
      1 + (n.content ?? []).reduce((sum, child) => sum + nodes(child), 0);
    const total = SEEDS.reduce((sum, seed) => sum + nodes(generate(seed).doc), 0);
    // A guard against the generator quietly collapsing to empty paragraphs and
    // the suite above passing on nothing.
    expect(total).toBeGreaterThan(500);
  });
});
