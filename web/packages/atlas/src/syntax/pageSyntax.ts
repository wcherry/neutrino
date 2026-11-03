import { parseLayout } from '../parse';
import { parseWikiLink, splitLines } from '../preprocess';
import { childrenOf, type MarkdownNode, type WikiLinkReference } from '../tree';

/**
 * Where each construct of a page sits in its source: what an editor needs to style Markdown in
 * place and, for Live Preview, to hide its syntax characters away from the cursor. AtlasKit's
 * `PageSyntax`, agreeing with it span for span.
 *
 * The tree decides *what* is there; this only finds *where*. Each top-level block's tree is
 * aligned against that block's text, character by character: delimiters, markers and escapes
 * become `syntax` spans, and the constructs around them get spans of their own. A block is
 * `isComplete` when every character of its text was accounted for. Otherwise its spans stop
 * where alignment did, and the rest of the block is left plain. Wrong styling is the worst
 * that can happen: the text is never touched.
 */
export interface PageSyntax {
  /**
   * In order. cmark-gfm lifts a footnote definition out of the quote or list item it was
   * written in, so that definition's lines can also be inside the block before it.
   */
  blocks: SyntaxBlock[];
}

export interface SyntaxBlock {
  node: MarkdownNode;
  /** UTF-16 offsets into the page, from the block's first character to the end of its last line (the line ending excluded). */
  from: number;
  to: number;
  /** Every character of the block's text was matched to its tree. */
  isComplete: boolean;
  /** The block's spans, ordered by start; a span that contains another comes first. */
  spans: SyntaxSpan[];
}

export type SyntaxRole =
  /** `## ` and a closing `##`, or a setext underline. */
  | 'headingMarker'
  /** `>` and the space after it. */
  | 'quoteMarker'
  /** `-`, `*`, `+`, `1.` or `1)`. */
  | 'listMarker'
  /** `[ ]` or `[x]`; the span's `checked` says which. */
  | 'taskMarker'
  /** A code block's fence lines, info string included. */
  | 'codeFence'
  /** A math block's `$$` lines. */
  | 'mathFence'
  /** Frontmatter's `---` lines. */
  | 'frontmatterFence'
  /** `**`, `_`, `~~`, `==`, a code span's backticks, inline math's `$`. */
  | 'delimiter'
  /** A link's `[` and `]`, an image's `![` and `]`, an autolink's `<` and `>`, a footnote reference's `[^` and `]`. */
  | 'linkBracket'
  /** `(url "title")`, `[label]` or `[]` after a link's text. */
  | 'linkDestination'
  /** `[[`, `]]` and an embed's `![[`. */
  | 'wikiBracket'
  /** A wiki link's `Target|`, before an alias. */
  | 'wikiTarget'
  /** The backslash of an escape. */
  | 'escape'
  /** A callout's `[!type]` and fold sign. */
  | 'calloutMarker'
  | 'tablePipe'
  | 'tableDelimiterRow'
  /** A footnote definition's `[^label]:`. */
  | 'footnoteLabel'
  /** `^id` (SPEC §4.6). */
  | 'blockId'
  /** The backslash of a hard line break. */
  | 'hardBreak';

export type SyntaxKind =
  // Blocks
  | { type: 'frontmatter' }
  | { type: 'heading'; level: number }
  | { type: 'blockquote' }
  | { type: 'callout'; calloutType: string }
  | { type: 'listItem'; ordered: boolean; checked: boolean | null }
  | { type: 'codeBlock'; language: string | null }
  | { type: 'mathBlock' }
  | { type: 'table' }
  | { type: 'thematicBreak' }
  | { type: 'htmlBlock' }
  | { type: 'footnoteDefinition'; identifier: string }
  // Inlines
  | { type: 'strong' }
  | { type: 'emphasis' }
  | { type: 'strikethrough' }
  | { type: 'highlight' }
  | { type: 'inlineCode' }
  | { type: 'inlineMath' }
  | { type: 'inlineHTML' }
  | { type: 'link'; url: string }
  | { type: 'image'; url: string }
  | { type: 'wikiLink'; ref: WikiLinkReference }
  | { type: 'embed'; ref: WikiLinkReference }
  | { type: 'tag'; name: string }
  | { type: 'footnoteReference'; identifier: string }
  /** Characters that are Markdown syntax rather than content. */
  | { type: 'syntax'; role: SyntaxRole; checked?: boolean };

export interface SyntaxSpan {
  kind: SyntaxKind;
  /** UTF-16 offsets into the page, as CodeMirror (and NSString) count. */
  from: number;
  to: number;
}

/** By start, and a span before the spans it contains. */
export function spanOrder(a: SyntaxSpan, b: SyntaxSpan): number {
  return a.from !== b.from ? a.from - b.from : b.to - a.to;
}

/** Every block's spans, ordered like `SyntaxBlock.spans`. */
export function allSpans(syntax: PageSyntax): SyntaxSpan[] {
  return syntax.blocks.flatMap((b) => b.spans).sort(spanOrder);
}

/** The page's syntax map: every top-level block, and where its constructs and syntax are. */
export function pageSyntax(source: string): PageSyntax {
  const lines = splitLines(source);
  const lineStart = [0];
  for (const l of lines) lineStart.push(lineStart[lineStart.length - 1] + l.content.length + l.ending.length);

  const blocks: SyntaxBlock[] = [];
  for (const { node, lines: range } of parseLayout(source)) {
    const first = Math.max(1, Math.min(range[0], lines.length));
    const last = Math.max(first, Math.min(range[1], lines.length));
    if (lines.length === 0 || range[0] > lines.length) continue;
    let text = '';
    for (let l = first; l <= last; l++) {
      text += lines[l - 1].content;
      if (l < last) text += lines[l - 1].ending;
    }
    const aligner = new SyntaxAligner(text, lineStart[first - 1]);
    const isComplete = aligner.align(node);
    blocks.push({ node, from: lineStart[first - 1], to: lineStart[first - 1] + text.length, isComplete, spans: aligner.spans.sort(spanOrder) });
  }
  return { blocks };
}

// ── Characters ────────────────────────────────────────────────────────────────

/**
 * The page's characters, as AtlasKit's aligner walks them: code points, except that `\r\n` is
 * one character, as it is to Swift.
 */
function characters(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    if (ch === '\n' && out[out.length - 1] === '\r') out[out.length - 1] = '\r\n';
    else out.push(ch);
  }
  return out;
}

const NEWLINES = new Set(['\n', '\r', '\r\n', '\v', '\f', '\u0085', ' ', ' ']);
const isNewline = (ch: string | undefined): boolean => ch !== undefined && NEWLINES.has(ch);
const isWhitespace = (ch: string | undefined): boolean => ch !== undefined && /^\p{White_Space}+$/u.test(ch);
const isSpaceOrTab = (ch: string | undefined): boolean => ch === ' ' || ch === '\t';
const isAsciiDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9';
const isAsciiPunctOrSymbol = (ch: string): boolean => ch.length === 1 && ch.charCodeAt(0) < 128 && /^[\p{P}\p{S}]$/u.test(ch);
const isAsciiAlphanumeric = (ch: string): boolean => /^[A-Za-z0-9]$/.test(ch);

class Mismatch extends Error {}

type Prefix = { kind: 'quote' } | { kind: 'indent'; width: number };
interface State {
  i: number;
  spans: number;
  prefixes: Prefix[];
}

/**
 * Aligns one top-level block's tree with its text. Container prefixes (`>` and list-item
 * indentation) are consumed at the start of every line, as cmark does; a line without them
 * is a lazy continuation.
 */
class SyntaxAligner {
  private readonly c: string[];
  /** `u16[k]` is the page offset of `c[k]`; one extra entry for the end. */
  private readonly u16: number[];
  private i = 0;
  private prefixes: Prefix[] = [];
  readonly spans: SyntaxSpan[] = [];

  constructor(text: string, offset: number) {
    this.c = characters(text);
    this.u16 = [offset];
    for (const ch of this.c) this.u16.push(this.u16[this.u16.length - 1] + ch.length);
  }

  /** Aligns the block and reports whether every character was accounted for. */
  align(node: MarkdownNode): boolean {
    if (this.c[0] === '﻿') this.i = 1;
    try {
      this.blocks([node]);
    } catch (e) {
      if (e instanceof Mismatch) return false;
      throw e;
    }
    // What's left can only be blank lines, and a quote's `>`-only lines.
    while (this.i < this.c.length && (isWhitespace(this.c[this.i]) || this.c[this.i] === '>')) this.i++;
    return this.i === this.c.length;
  }

  // ── Cursor ──────────────────────────────────────────────────────────────────

  private get state(): State {
    return { i: this.i, spans: this.spans.length, prefixes: [...this.prefixes] };
  }
  private restore(s: State): void {
    this.i = s.i;
    this.spans.length = s.spans;
    this.prefixes = [...s.prefixes];
  }

  private at(k: number): string | undefined {
    return this.c[k];
  }
  private get atEOL(): boolean {
    return this.i >= this.c.length || isNewline(this.c[this.i]);
  }
  private get restIsBlank(): boolean {
    let k = this.i;
    while (k < this.c.length && isSpaceOrTab(this.c[k])) k++;
    return k >= this.c.length || isNewline(this.c[k]);
  }
  private startsWith(s: string, k: number): boolean {
    for (const ch of s) {
      if (this.at(k) !== ch) return false;
      k++;
    }
    return true;
  }

  private skipSpaces(): void {
    while (isSpaceOrTab(this.at(this.i))) this.i++;
  }
  private skipSpacesUpTo(n: number): void {
    for (let k = 0; k < n && this.at(this.i) === ' '; k++) this.i++;
  }
  private toEOL(): void {
    while (this.i < this.c.length && !isNewline(this.c[this.i])) this.i++;
  }
  private expect(ch: string): void {
    if (this.at(this.i) !== ch) throw new Mismatch();
    this.i++;
  }
  private attempt(body: () => void): boolean {
    try {
      body();
      return true;
    } catch (e) {
      if (e instanceof Mismatch) return false;
      throw e;
    }
  }

  private mark(role: SyntaxRole, from: number, to: number, checked?: boolean): void {
    if (from >= to) return;
    const kind: SyntaxKind = checked === undefined ? { type: 'syntax', role } : { type: 'syntax', role, checked };
    this.spans.push({ kind, from: this.u16[from], to: this.u16[to] });
  }
  private span(kind: SyntaxKind, start: number): void {
    this.spans.push({ kind, from: this.u16[start], to: this.u16[this.i] });
  }

  /** Past a line ending and the container prefixes of the next line. */
  private newline(): void {
    if (!isNewline(this.at(this.i))) throw new Mismatch();
    this.i++;
    this.enterLine();
  }

  private enterLine(): void {
    for (const p of this.prefixes) {
      if (p.kind === 'quote') {
        const save = this.i;
        this.skipSpacesUpTo(3);
        if (this.at(this.i) !== '>') {
          this.i = save;
          return;
        }
        const start = this.i;
        this.i++;
        if (isSpaceOrTab(this.at(this.i))) this.i++;
        this.mark('quoteMarker', start, this.i);
      } else {
        let columns = 0;
        while (columns < p.width && isSpaceOrTab(this.at(this.i))) {
          columns += this.at(this.i) === '\t' ? 4 - (columns % 4) : 1;
          this.i++;
        }
        if (columns < p.width) return;
      }
    }
  }

  /** From the end of one block to the start of the next: the rest of the line, then any blank lines. */
  private toNextBlock(): void {
    if (!this.restIsBlank || this.i >= this.c.length) return;
    this.toEOL();
    if (!this.attempt(() => this.newline())) return;
    while (this.restIsBlank && this.i < this.c.length) {
      const save = this.state;
      this.toEOL();
      if (this.i >= this.c.length) return this.restore(save);
      if (!this.attempt(() => this.newline())) return this.restore(save);
    }
  }

  private get lineLooksLikeReferenceDefinition(): boolean {
    let k = this.i;
    for (let n = 0; this.at(k) === ' ' && n < 3; n++) k++;
    if (this.at(k) !== '[') return false;
    for (let ch = this.at(k); ch !== undefined && !isNewline(ch); ch = this.at(++k)) {
      if (ch === ']') return this.at(k + 1) === ':';
    }
    return false;
  }

  // ── Blocks ──────────────────────────────────────────────────────────────────

  private blocks(kids: MarkdownNode[]): void {
    for (const kid of kids) {
      this.toNextBlock();
      for (;;) {
        const save = this.state;
        try {
          this.block(kid);
          break;
        } catch (e) {
          // A reference definition isn't in the tree; skip its line and try again.
          this.restore(save);
          if (!(e instanceof Mismatch) || !this.lineLooksLikeReferenceDefinition) throw e;
          this.toEOL();
          this.newline();
          this.toNextBlock();
        }
      }
    }
    // Definitions after the last block, or in a container with nothing else in it. A
    // footnote definition takes its continuation lines with it.
    for (;;) {
      const save = this.state;
      this.toNextBlock();
      if (!this.lineLooksLikeReferenceDefinition) {
        this.restore(save);
        break;
      }
      let k = this.i;
      while (this.at(k) === ' ') k++;
      const footnote = this.startsWith('[^', k);
      this.toEOL();
      while (footnote && this.i < this.c.length) {
        const line = this.state;
        if (!this.attempt(() => this.newline()) || this.restIsBlank) {
          this.restore(line);
          break;
        }
        this.toEOL();
      }
    }
  }

  private block(node: MarkdownNode): void {
    switch (node.type) {
      case 'root':
        return this.blocks(node.children);

      case 'paragraph':
        this.skipSpaces();
        this.inlines(node.children);
        if (node.blockId !== null) this.trailingBlockId(node.blockId);
        this.skipSpaces();
        return;

      case 'heading': {
        const start = this.i;
        this.skipSpacesUpTo(3);
        let run = 0;
        while (this.at(this.i + run) === '#') run++;
        const after = this.at(this.i + run);
        const atx = run > 0 && (after === undefined || isSpaceOrTab(after) || isNewline(after));
        if (atx) {
          const m = this.i;
          while (this.at(this.i) === '#') this.i++;
          if (this.i - m !== node.depth) throw new Mismatch();
          this.skipSpaces();
          this.mark('headingMarker', m, this.i);
          this.inlines(node.children);
          const save = this.i;
          this.skipSpaces();
          if (this.at(this.i) === '#') {
            while (this.at(this.i) === '#') this.i++;
            this.skipSpaces();
            if (this.atEOL) this.mark('headingMarker', save, this.i);
            else this.i = save;
          }
          this.skipSpaces();
        } else {
          this.inlines(node.children);
          this.skipSpaces();
          this.newline();
          this.skipSpacesUpTo(3);
          const m = this.i;
          const ch = this.at(this.i);
          if (ch !== '=' && ch !== '-') throw new Mismatch();
          while (this.at(this.i) === ch) this.i++;
          this.skipSpaces();
          if (!this.atEOL) throw new Mismatch();
          this.mark('headingMarker', m, this.i);
        }
        return this.span({ type: 'heading', level: node.depth }, start);
      }

      case 'thematicBreak': {
        const start = this.i;
        this.toEOL();
        return this.span({ type: 'thematicBreak' }, start);
      }

      case 'code': {
        const start = this.i;
        this.codeBlock(node.value);
        this.span({ type: 'codeBlock', language: node.lang }, start);
        if (node.blockId !== null) this.standaloneBlockId(node.blockId);
        return;
      }

      case 'math': {
        const start = this.i;
        this.skipSpacesUpTo(3);
        if (!this.startsWith('$$', this.i)) throw new Mismatch();
        const f = this.i;
        this.toEOL();
        this.mark('mathFence', f, this.i);
        for (;;) {
          this.newline();
          const line = this.i;
          this.toEOL();
          if (/^ {0,3}\$\$[ \t]*$/.test(this.c.slice(line, this.i).join(''))) {
            this.mark('mathFence', line, this.i);
            break;
          }
        }
        this.span({ type: 'mathBlock' }, start);
        if (node.blockId !== null) this.standaloneBlockId(node.blockId);
        return;
      }

      case 'html': {
        const start = this.i;
        this.toEOL();
        for (let n = countNewlines(node.value); n > 0; n--) {
          this.newline();
          this.toEOL();
        }
        return this.span({ type: 'htmlBlock' }, start);
      }

      case 'blockquote': {
        const start = this.i;
        this.quoteMarker();
        this.prefixes.push({ kind: 'quote' });
        this.blocks(node.children);
        this.prefixes.pop();
        this.span({ type: 'blockquote' }, start);
        if (node.blockId !== null) this.standaloneBlockId(node.blockId);
        return;
      }

      case 'callout': {
        const start = this.i;
        this.quoteMarker();
        this.prefixes.push({ kind: 'quote' });
        this.skipSpaces();
        if (!this.startsWith('[!', this.i)) throw new Mismatch();
        const m = this.i;
        for (let ch = this.at(this.i); ch !== undefined && ch !== ']' && !isNewline(ch); ch = this.at(++this.i));
        this.expect(']');
        if (this.at(this.i) === '+' || this.at(this.i) === '-') this.i++;
        this.mark('calloutMarker', m, this.i);
        this.skipSpaces();
        this.inlines(node.title ?? []);
        let idUsed = false;
        if (node.blockId !== null) {
          const save = this.state;
          const id = node.blockId;
          if (this.attempt(() => this.trailingBlockId(id))) idUsed = true;
          else this.restore(save);
        }
        this.blocks(node.children);
        this.prefixes.pop();
        this.span({ type: 'callout', calloutType: node.calloutType }, start);
        if (node.blockId !== null && !idUsed) this.standaloneBlockId(node.blockId);
        return;
      }

      case 'list':
        for (const item of node.children) {
          this.toNextBlock();
          if (item.type !== 'listItem') throw new Mismatch();
          this.listItem(node.ordered, item.checked, item.children);
        }
        if (node.blockId !== null) this.standaloneBlockId(node.blockId);
        return;

      case 'table': {
        const start = this.i;
        const rows = node.children;
        rows.forEach((row, r) => {
          if (r > 0) this.newline();
          if (r === 1) {
            const d = this.i;
            this.toEOL();
            this.mark('tableDelimiterRow', d, this.i);
            this.newline();
          }
          this.tableRow(childrenOf(row));
        });
        if (rows.length === 1) {
          // A header with no body: the delimiter row still follows.
          this.newline();
          const d = this.i;
          this.toEOL();
          this.mark('tableDelimiterRow', d, this.i);
        }
        this.span({ type: 'table' }, start);
        if (node.blockId !== null) this.standaloneBlockId(node.blockId);
        return;
      }

      case 'footnoteDefinition': {
        const start = this.i;
        // cmark-gfm lifts a definition out of the quote or list item it was written in, and
        // reports it at the top level from the container's markers.
        for (let ch = this.at(this.i); ch !== undefined && ' \t>-+*.)0123456789'.includes(ch) && !this.startsWith('[^', this.i); ch = this.at(++this.i));
        if (!this.startsWith('[^', this.i)) throw new Mismatch();
        const m = this.i;
        for (let ch = this.at(this.i); ch !== undefined && ch !== ']' && !isNewline(ch); ch = this.at(++this.i));
        this.expect(']');
        this.expect(':');
        this.mark('footnoteLabel', m, this.i);
        this.skipSpaces();
        this.prefixes.push({ kind: 'indent', width: 4 });
        this.blocks(node.children);
        this.prefixes.pop();
        return this.span({ type: 'footnoteDefinition', identifier: node.identifier }, start);
      }

      case 'yaml': {
        const start = this.i;
        this.toEOL();
        this.mark('frontmatterFence', start, this.i);
        let line = this.i;
        while (this.i < this.c.length) {
          this.newline();
          line = this.i;
          this.toEOL();
        }
        this.mark('frontmatterFence', line, this.i);
        return this.span({ type: 'frontmatter' }, start);
      }

      case 'listItem':
      case 'tableRow':
      case 'tableCell':
        throw new Mismatch();

      default:
        // An inline at block level can't happen; align it anyway.
        return this.inline(node);
    }
  }

  private quoteMarker(): void {
    this.skipSpacesUpTo(3);
    const m = this.i;
    this.expect('>');
    if (isSpaceOrTab(this.at(this.i))) this.i++;
    this.mark('quoteMarker', m, this.i);
  }

  private codeBlock(value: string): void {
    const save = this.i;
    this.skipSpacesUpTo(3);
    const lineCount = value === '' ? 0 : countNewlines(value) + 1;
    const fenceChar = this.at(this.i);
    if ((fenceChar !== '`' && fenceChar !== '~') || !this.startsWith(fenceChar.repeat(3), this.i)) {
      // Indented.
      this.i = save;
      this.toEOL();
      for (let n = 1; n < Math.max(lineCount, 1); n++) {
        this.newline();
        this.toEOL();
      }
      return;
    }
    const f = this.i;
    let n = 0;
    while (this.at(this.i) === fenceChar) {
      this.i++;
      n++;
    }
    this.toEOL();
    this.mark('codeFence', f, this.i);
    // An empty value is no lines or one blank line; try both.
    for (const count of value === '' ? [0, 1] : [lineCount]) {
      const before = this.state;
      let ok = true;
      for (let k = 0; k < count; k++) {
        if (!this.attempt(() => this.newline())) {
          ok = false;
          break;
        }
        this.toEOL();
      }
      if (ok && this.closingFence(fenceChar, n)) return;
      this.restore(before);
    }
    // Unclosed: it runs to the end of its container.
    for (let k = 0; k < lineCount; k++) {
      this.newline();
      this.toEOL();
    }
  }

  private closingFence(ch: string, n: number): boolean {
    const save = this.state;
    if (!this.attempt(() => this.newline())) {
      this.restore(save);
      return false;
    }
    this.skipSpacesUpTo(3);
    const f = this.i;
    let m = 0;
    while (this.at(this.i) === ch) {
      this.i++;
      m++;
    }
    this.skipSpaces();
    if (m < n || !this.atEOL) {
      this.restore(save);
      return false;
    }
    this.mark('codeFence', f, this.i);
    return true;
  }

  private listItem(ordered: boolean, checked: boolean | null, kids: MarkdownNode[]): void {
    const start = this.i;
    let lead = 0;
    while (this.at(this.i) === ' ' && lead < 3) {
      this.i++;
      lead++;
    }
    const m = this.i;
    if (ordered) {
      while (isAsciiDigit(this.at(this.i))) this.i++;
      if (this.i <= m || (this.at(this.i) !== '.' && this.at(this.i) !== ')')) throw new Mismatch();
      this.i++;
    } else {
      const ch = this.at(this.i);
      if (ch !== '-' && ch !== '*' && ch !== '+') throw new Mismatch();
      this.i++;
    }
    this.mark('listMarker', m, this.i);
    const markerWidth = this.i - m;
    let width: number;
    if (this.restIsBlank) {
      width = lead + markerWidth + 1;
    } else {
      let spaces = 0;
      let k = this.i;
      while (isSpaceOrTab(this.at(k))) {
        spaces += this.at(k) === '\t' ? 4 - ((lead + markerWidth + spaces) % 4) : 1;
        k++;
      }
      if (spaces >= 5) {
        width = lead + markerWidth + 1;
        this.i++;
      } else {
        width = lead + markerWidth + spaces;
        this.i = k;
      }
    }
    if (checked !== null) {
      const t = this.i;
      const box = this.at(this.i + 1);
      if (this.at(this.i) !== '[' || (box !== ' ' && box !== 'x' && box !== 'X') || this.at(this.i + 2) !== ']') throw new Mismatch();
      this.i += 3;
      this.mark('taskMarker', t, this.i, checked);
      this.skipSpaces();
    }
    this.prefixes.push({ kind: 'indent', width });
    this.blocks(kids);
    this.prefixes.pop();
    this.span({ type: 'listItem', ordered, checked }, start);
  }

  private tableRow(cells: MarkdownNode[]): void {
    this.skipSpaces();
    if (this.at(this.i) === '|') {
      this.mark('tablePipe', this.i, this.i + 1);
      this.i++;
    }
    for (const cell of cells) {
      this.skipSpaces();
      if (this.atEOL) {
        // GFM pads a short row with empty cells.
        if (childrenOf(cell).length > 0) throw new Mismatch();
        continue;
      }
      this.inlines(childrenOf(cell));
      this.skipSpaces();
      if (this.at(this.i) === '|') {
        this.mark('tablePipe', this.i, this.i + 1);
        this.i++;
      } else if (!this.atEOL) {
        throw new Mismatch();
      }
    }
    // GFM drops the cells beyond the header's count.
    this.toEOL();
  }

  private trailingBlockId(id: string): void {
    this.skipSpaces();
    const m = this.i;
    this.expect('^');
    for (const ch of id) this.expect(ch);
    this.mark('blockId', m, this.i);
    this.skipSpaces();
    if (!this.atEOL) throw new Mismatch();
  }

  /** A `^id` paragraph after a block names it and leaves the tree (SPEC §4.6). */
  private standaloneBlockId(id: string): void {
    const save = this.state;
    if (!this.restIsBlank || this.i >= this.c.length) return;
    this.toEOL();
    if (!this.attempt(() => this.newline())) return this.restore(save);
    this.toNextBlock();
    if (!this.attempt(() => this.trailingBlockId(id))) this.restore(save);
  }

  // ── Inlines ─────────────────────────────────────────────────────────────────

  private inlines(nodes: MarkdownNode[]): void {
    for (const n of nodes) this.inline(n);
  }

  private inline(node: MarkdownNode): void {
    const start = this.i;
    switch (node.type) {
      case 'text': {
        const v = characters(node.value);
        for (let k = 0; k < v.length; ) k += this.character(v, k);
        return;
      }

      case 'break':
        this.skipSpaces();
        if (this.at(this.i) === '\\') {
          this.mark('hardBreak', this.i, this.i + 1);
          this.i++;
        }
        this.newline();
        this.skipSpaces();
        return;

      case 'strong':
        return this.delimited({ type: 'strong' }, 2, node.children, (d) => d === '*' || d === '_');
      case 'emphasis':
        return this.delimited({ type: 'emphasis' }, 1, node.children, (d) => d === '*' || d === '_');
      case 'highlight':
        return this.delimited({ type: 'highlight' }, 2, node.children, (d) => d === '=');
      case 'delete':
        return this.delimited({ type: 'strikethrough' }, this.at(this.i + 1) === '~' ? 2 : 1, node.children, (d) => d === '~');

      case 'inlineCode': {
        if (this.at(this.i) !== '`') throw new Mismatch();
        let n = 0;
        while (this.at(this.i) === '`') {
          this.i++;
          n++;
        }
        this.mark('delimiter', start, this.i);
        for (;;) {
          const ch = this.at(this.i);
          if (ch === undefined) throw new Mismatch();
          if (ch === '`') {
            const r = this.i;
            let m = 0;
            while (this.at(this.i) === '`') {
              this.i++;
              m++;
            }
            if (m === n) {
              this.mark('delimiter', r, this.i);
              break;
            }
          } else if (isNewline(ch)) {
            this.newline();
          } else {
            this.i++;
          }
        }
        return this.span({ type: 'inlineCode' }, start);
      }

      case 'inlineMath': {
        const end = this.at(this.i) === '$' ? inlineMathEnd(this.c, this.i) : null;
        if (end === null) throw new Mismatch();
        const n = this.at(this.i + 1) === '$' ? 2 : 1;
        this.mark('delimiter', this.i, this.i + n);
        this.mark('delimiter', end - n, end);
        this.i = end;
        return this.span({ type: 'inlineMath' }, start);
      }

      case 'wikiLink':
      case 'embed': {
        const ch = this.at(this.i);
        const end = ch === '[' || ch === '!' ? wikiLinkEnd(this.c, this.i) : null;
        if (end === null) throw new Mismatch();
        const isEmbed = ch === '!';
        const open = this.i + (isEmbed ? 3 : 2);
        this.mark('wikiBracket', this.i, open);
        if (node.alias !== null) {
          let bar = -1;
          for (let k = open; k < end - 2; k++) {
            if (this.c[k] === '|') {
              bar = k;
              break;
            }
          }
          if (bar >= 0) this.mark('wikiTarget', open, bar + 1);
        }
        this.mark('wikiBracket', end - 2, end);
        this.i = end;
        const ref: WikiLinkReference = { target: node.target, heading: node.heading, blockId: node.blockId, alias: node.alias };
        return this.span(isEmbed ? { type: 'embed', ref } : { type: 'wikiLink', ref }, start);
      }

      case 'tag':
        this.expect('#');
        for (const ch of node.name) this.expect(ch);
        return this.span({ type: 'tag', name: node.name }, start);

      case 'footnoteReference': {
        if (!this.startsWith('[^', this.i)) throw new Mismatch();
        this.mark('linkBracket', this.i, this.i + 2);
        this.i += 2;
        for (let ch = this.at(this.i); ch !== undefined && ch !== ']' && !isNewline(ch); ch = this.at(++this.i));
        const close = this.i;
        this.expect(']');
        this.mark('linkBracket', close, this.i);
        return this.span({ type: 'footnoteReference', identifier: node.identifier }, start);
      }

      case 'html':
        for (const ch of characters(node.value)) {
          if (isNewline(ch)) {
            this.newline();
            this.skipSpaces();
          } else {
            this.expect(ch);
          }
        }
        return this.span({ type: 'inlineHTML' }, start);

      case 'link': {
        if (this.at(this.i) === '[') {
          this.mark('linkBracket', this.i, this.i + 1);
          this.i++;
          this.inlines(node.children);
          const close = this.i;
          this.expect(']');
          this.mark('linkBracket', close, this.i);
          this.destination();
        } else if (this.at(this.i) === '<') {
          this.mark('linkBracket', this.i, this.i + 1);
          for (let ch = this.at(this.i); ch !== undefined && ch !== '>' && !isNewline(ch); ch = this.at(++this.i));
          const close = this.i;
          this.expect('>');
          this.mark('linkBracket', close, this.i);
        } else {
          // A GFM autolink: the text is the link.
          this.inlines(node.children);
        }
        return this.span({ type: 'link', url: node.url }, start);
      }

      case 'image': {
        if (!this.startsWith('![', this.i)) throw new Mismatch();
        this.mark('linkBracket', this.i, this.i + 2);
        this.i += 2;
        let depth = 0;
        for (;;) {
          const ch = this.at(this.i);
          if (ch === undefined) throw new Mismatch();
          if (ch === '\\') {
            this.i += 2;
            continue;
          }
          if (ch === '[') depth++;
          if (ch === ']') {
            if (depth === 0) break;
            depth--;
          }
          if (isNewline(ch)) {
            this.newline();
            continue;
          }
          this.i++;
        }
        this.mark('linkBracket', this.i, this.i + 1);
        this.i++;
        this.destination();
        return this.span({ type: 'image', url: node.url }, start);
      }

      default:
        throw new Mismatch();
    }
  }

  /** A link's or image's `(destination "title")` or `[label]`, when one follows. */
  private destination(): void {
    const end = this.at(this.i) === '(' ? this.destinationEnd(this.i) : this.at(this.i) === '[' ? this.labelEnd(this.i) : null;
    if (end === null) return;
    this.mark('linkDestination', this.i, end);
    this.i = end;
  }

  /**
   * Matches `v[k]`, the next character of a text node, and returns how many of `v` it used:
   * the character itself, an escape for it, or a character reference that decodes to it.
   */
  private character(v: string[], k: number): number {
    const ch = v[k];
    const s = this.at(this.i);
    if (s === undefined) throw new Mismatch();
    if (s === '&') {
      const end = this.entityEnd(this.i);
      if (end !== null) {
        const entity = this.c.slice(this.i, end);
        // Kept as written (a GFM autolink's text, an unknown name): match it literally.
        if (k + entity.length <= v.length && entity.every((e, j) => v[k + j] === e)) {
          this.i = end;
          return entity.length;
        }
        const decoded = decodeEntity(entity.join(''));
        if (decoded === null ? s !== ch : decoded === ch) {
          this.i = end;
          return 1;
        }
      }
    }
    if (isNewline(ch)) {
      // A soft line break: trailing spaces, the ending, the prefixes, leading spaces.
      this.skipSpaces();
      this.newline();
      this.skipSpaces();
      return 1;
    }
    const next = this.at(this.i + 1);
    if (s === '\\' && next !== undefined && next === ch && isAsciiPunctOrSymbol(next)) {
      this.mark('escape', this.i, this.i + 1);
      this.i += 2;
      return 1;
    }
    if (s !== ch) throw new Mismatch();
    this.i++;
    return 1;
  }

  private delimited(kind: SyntaxKind, n: number, kids: MarkdownNode[], allowed: (d: string) => boolean): void {
    const start = this.i;
    const d = this.at(this.i);
    const run = (from: number) => {
      for (let k = 0; k < n; k++) if (this.at(from + k) !== d) return false;
      return true;
    };
    if (d === undefined || !allowed(d) || !run(this.i)) throw new Mismatch();
    this.i += n;
    this.mark('delimiter', start, this.i);
    this.inlines(kids);
    if (!run(this.i)) throw new Mismatch();
    this.mark('delimiter', this.i, this.i + n);
    this.i += n;
    this.span(kind, start);
  }

  // ── Link pieces ─────────────────────────────────────────────────────────────

  /** The end of `(destination "title")` starting at `k`. */
  private destinationEnd(k: number): number | null {
    let j = k + 1;
    const skipWhitespace = () => {
      while (isWhitespace(this.at(j))) j++;
    };
    skipWhitespace();
    if (this.at(j) === '<') {
      for (let ch = this.at(j); ch !== undefined && ch !== '>'; ch = this.at(j)) {
        if (ch === '\\') j++;
        if (isNewline(ch)) return null;
        j++;
      }
      if (this.at(j) !== '>') return null;
      j++;
    } else {
      let depth = 0;
      for (let ch = this.at(j); ch !== undefined; ch = this.at(j)) {
        if (ch === '\\') {
          j += 2;
          continue;
        }
        if (isWhitespace(ch)) break;
        if (ch === '(') depth++;
        if (ch === ')') {
          if (depth === 0) break;
          depth--;
        }
        j++;
      }
    }
    skipWhitespace();
    const open = this.at(j);
    if (open === '"' || open === "'" || open === '(') {
      const close = open === '(' ? ')' : open;
      j++;
      for (let ch = this.at(j); ch !== undefined && ch !== close; ch = this.at(j)) {
        if (ch === '\\') j++;
        j++;
      }
      if (this.at(j) !== close) return null;
      j++;
      skipWhitespace();
    }
    return this.at(j) === ')' ? j + 1 : null;
  }

  /** The end of a reference label `[label]` (or `[]`) starting at `k`. */
  private labelEnd(k: number): number | null {
    let j = k + 1;
    for (let ch = this.at(j); ch !== undefined && ch !== ']'; ch = this.at(j)) {
      if (ch === '\\') j++;
      if (ch === '[') return null;
      j++;
    }
    return this.at(j) === ']' ? j + 1 : null;
  }

  /** The end of a character reference (`&amp;`, `&#38;`, `&#x26;`) starting at `k`. */
  private entityEnd(k: number): number | null {
    let j = k + 1;
    for (let ch = this.at(j); ch !== undefined && j - k <= 32 && (isAsciiAlphanumeric(ch) || ch === '#'); ch = this.at(j)) j++;
    return j > k + 1 && this.at(j) === ';' ? j + 1 : null;
  }
}

function countNewlines(value: string): number {
  let n = 0;
  for (const ch of characters(value)) if (ch === '\n') n++;
  return n;
}

/** The end of inline math starting at `c[i]` (SPEC §4.4), as the preprocessor finds it. */
function inlineMathEnd(c: string[], i: number): number | null {
  const double = c[i + 1] === '$';
  const start = i + (double ? 2 : 1);
  if (start >= c.length || isWhitespace(c[start]) || c[start] === '$') return null;
  for (let j = start + 1; j < c.length && !isNewline(c[j]); j++) {
    if (c[j] !== '$') continue;
    if (double) {
      if (c[j + 1] === '$') return j + 2;
    } else if (!isWhitespace(c[j - 1]) && c[j - 1] !== '\\' && !isAsciiDigit(c[j + 1])) {
      return j + 1;
    }
  }
  return null;
}

/** The end of `[[…]]` or `![[…]]` starting at `c[i]` (SPEC §4.2, §4.3), as the preprocessor finds it. */
function wikiLinkEnd(c: string[], i: number): number | null {
  const open = c[i] === '!' ? i + 1 : i;
  if (c[open] !== '[' || c[open + 1] !== '[') return null;
  for (let j = open + 2; j + 1 < c.length; j++) {
    const ch = c[j];
    if (isNewline(ch) || ch === '[') return null;
    if (ch === ']') {
      if (c[j + 1] !== ']') return null;
      return parseWikiLink(c.slice(open + 2, j).join('')) ? j + 2 : null;
    }
  }
  return null;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
};

/**
 * What a character reference decodes to, when that's known here. Null for named references
 * outside the short table above: the caller then assumes it decoded to the expected character.
 */
function decodeEntity(entity: string): string | null {
  const body = entity.slice(1, -1);
  if (body.startsWith('#')) {
    const digits = body.slice(1);
    const hex = digits[0] === 'x' || digits[0] === 'X';
    const text = hex ? digits.slice(1) : digits;
    if (!(hex ? /^[0-9A-Fa-f]+$/ : /^[0-9]+$/).test(text)) return null;
    const v = parseInt(text, hex ? 16 : 10);
    // Swift's UInt32 parse: anything past 32 bits doesn't parse.
    if (v > 0xffffffff) return null;
    return v > 0x10ffff || (v >= 0xd800 && v <= 0xdfff) ? '�' : String.fromCodePoint(v);
  }
  return Object.hasOwn(ENTITIES, body) ? ENTITIES[body] : null;
}
