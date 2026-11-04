import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTaskListItemFromMarkdown } from 'mdast-util-gfm-task-list-item';
import { gfmFootnote } from 'micromark-extension-gfm-footnote';
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item';
import { atlasAttention, atlasStrikethrough } from './attention';
import { atlasAutolinks, atlasAutolinksFromMarkdown, emailAutolinks } from './autolinks';
import { atlasContainers } from './containers';
import { atlasTable, isDelimiterRow, rowCells, type ParseInfo } from './tables';
import { atlasCodeSpans } from './codeSpans';
import { atlasHtml } from './html';
import type * as Mdast from 'mdast';
import { MATH_INFO, splitLines } from './preprocess';
import type { Align, MarkdownNode } from './tree';
import { flankingText, sourceLines, standaloneIdLine } from './tree';

/**
 * Parses preprocessed source as CommonMark + GFM (SPEC §2) with micromark, and converts its
 * mdast to the Atlas tree. micromark differs from cmark-gfm, which the spec follows, in the ways
 * §3.3 lists; each is normalised here, and the corpus pins every one.
 *
 * Placeholder tokens and escape markers from the preprocessor pass through as ordinary text;
 * the extension passes deal with them.
 */

export interface TopLevelBlock {
  node: MarkdownNode;
  /** The 1-based source lines its content occupies. */
  lines: [number, number];
}

export interface Conversion {
  blocks: TopLevelBlock[];
  /**
   * Where each task item's list marker is, in tree order: 1-based line, and UTF-16 column from
   * the line's start. Lines and the text before a marker are the same in the original source,
   * which offsets into the preprocessed text aren't.
   */
  tasks: { line: number; column: number }[];
}

type AnyNode = Mdast.Nodes;

export function convert(source: string): Conversion {
  const first = parseTree(source);
  // Definitions right after a task's box are the page's, in cmark-gfm, though micromark reads
  // them as text (`boxDefinitions`). Parsing again with them at the end lets references find them.
  const converter = new Converter(source, first.tree, first.parse);
  const hidden = converter.hiddenDefinitions();
  if (hidden.length) {
    const lines = splitLines(source).length;
    const again = parseTree(source + '\n\n' + hidden.join('\n'));
    const appended = again.tree.children.filter((n) => n.position!.start.line > lines);
    if (appended.length === hidden.length && appended.every((n) => n.type === 'definition')) {
      again.tree.children = again.tree.children.slice(0, -appended.length);
      return new Converter(source, again.tree, again.parse, appended).run();
    }
  }
  return converter.run();
}

function parseTree(source: string): { tree: Mdast.Root; parse: ParseInfo } {
  // GFM (§2) without micromark's autolinking: cmark-gfm's, as AtlasKit runs it, instead.
  const parse: ParseInfo = { lazy: {} };
  const tree = fromMarkdown(source, {
    extensions: [gfmFootnote(), atlasStrikethrough(), atlasTable(source, parse), gfmTaskListItem(), atlasAutolinks(), atlasAttention(source), atlasCodeSpans(), atlasHtml(source), atlasContainers()],
    mdastExtensions: [gfmFootnoteFromMarkdown(), gfmStrikethroughFromMarkdown(), gfmTableFromMarkdown(), gfmTaskListItemFromMarkdown(), atlasAutolinksFromMarkdown()],
  });
  return { tree, parse };
}

/**
 * The reference definitions at the start of `text`, as CommonMark reads a paragraph's: their
 * source, and where the rest of the text starts.
 */
function leadingDefinitions(text: string): { raw: string[]; rest: number } | null {
  if (!text.startsWith('[')) return null;
  const raw: string[] = [];
  let rest = text.length;
  for (const n of fromMarkdown(text).children) {
    if (n.type !== 'definition') { rest = n.position!.start.offset!; break; }
    raw.push(text.slice(n.position!.start.offset, n.position!.end.offset));
  }
  return raw.length ? { raw, rest } : null;
}

class Converter {
  private lines: string[];
  /** UTF-16 offset of each line's start, 0-based by line index. */
  private lineStarts: number[] = [];
  private definitions = new Map<string, { url: string; title: string | null }>();
  /** Footnote labels some reference uses (lowercased), and every valid definition seen. */
  private usedFootnotes = new Set<string>();
  /** The first definition of each footnote label, in document order: cmark-gfm drops any later one. */
  private firstFootnotes = new Map<string, AnyNode>();
  private tasks: { line: number; column: number }[] = [];
  /** Footnote definitions found inside containers, lifted to the top level (§3.2). */
  private nestedDefinitions: { node: MarkdownNode; line: number; afterTop: number }[] = [];
  private currentTop = 0;
  /** HTML blocks moved out of a list item (`lazyHtml`). */
  private hoisted = new WeakSet<object>();

  constructor(private source: string, private tree: Mdast.Root, private parse: ParseInfo, hidden: Mdast.Nodes[] = []) {
    const split = splitLines(source);
    this.lines = split.map((l) => l.content);
    let offset = 0;
    for (const l of split) { this.lineStarts.push(offset); offset += l.content.length + l.ending.length; }
    this.collect(tree);
    for (const d of hidden) this.collect(d);
  }

  /**
   * What follows reference definitions on the next line, as cmark-gfm reads it. cmark resolves
   * definitions when the paragraph holding them closes, so the next line still belongs to it:
   * - A `---` line is a setext underline for that paragraph, which turns out to hold nothing but
   *   definitions, so there's no heading and the line is text (micromark: a thematic break).
   * - A lazy line keeps its leading whitespace, as lazy lines do in cmark, and with the
   *   definitions gone it starts the paragraph's text.
   */
  private afterDefinitions(parent: Mdast.Parent): void {
    const kids = parent.children as AnyNode[];
    for (let i = 1; i < kids.length; i++) {
      const prev = kids[i - 1], cur = kids[i];
      if (prev.type === 'definition' && prev.position!.end.line + 1 === cur.position!.start.line && !this.parse.lazy[cur.position!.start.line]) {
        const start = cur.position!.start;
        const text = this.lines[start.line - 1].slice(start.offset! - this.lineStarts[start.line - 1]);
        if (cur.type === 'thematicBreak' && /^-+[ \t]*$/.test(text)) {
          const next = kids[i + 1];
          const joined = next?.type === 'paragraph' && next.position!.start.line === start.line + 1;
          const children: Mdast.PhrasingContent[] = [{ type: 'text', value: text.trimEnd() + (joined ? '\n' : '') }, ...(joined ? next.children : [])];
          kids.splice(i, joined ? 2 : 1, { type: 'paragraph', children, position: { start, end: (joined ? next : cur).position!.end } });
        }
      } else if (prev.type === 'definition' && prev.position!.end.line + 1 === cur.position!.start.line && cur.type === 'paragraph') {
        const start = cur.position!.start;
        const before = this.lines[start.line - 1].slice(0, start.offset! - this.lineStarts[start.line - 1]);
        const space = /[ \t]*$/.exec(before)![0];
        const kept = before.length > space.length && before[before.length - space.length - 1] === '>' ? space.slice(1) : space;
        if (kept) cur.children.unshift({ type: 'text', value: kept });
      }
    }
    for (const kid of kids) if ('children' in kid) this.afterDefinitions(kid as Mdast.Parent);
  }

  /** Definitions (for resolving references) and the footnotes references use. */
  private collect(node: AnyNode): void {
    if (node.type === 'definition' && !this.definitions.has(node.identifier)) {
      this.definitions.set(node.identifier, { url: node.url, title: node.title ?? null });
    }
    if (node.type === 'footnoteDefinition' && !this.firstFootnotes.has((node.label ?? node.identifier).toLowerCase())) {
      this.firstFootnotes.set((node.label ?? node.identifier).toLowerCase(), node);
    }
    if (node.type === 'footnoteReference' && validFootnoteLabel(node.label ?? node.identifier)) {
      this.usedFootnotes.add((node.label ?? node.identifier).toLowerCase());
    }
    if ('children' in node) for (const c of node.children as AnyNode[]) this.collect(c);
  }

  run(): Conversion {
    this.afterDefinitions(this.tree);
    const top = this.tree.children.filter((n) => n.type !== 'definition');
    const blocks: TopLevelBlock[] = [];
    top.forEach((n, i) => {
      this.currentTop = blocks.length;
      const start = n.position!.start.line;
      const next = top[i + 1]?.position?.start.line;
      if (n.type === 'list') { blocks.push(...this.listParts(n)); return; }
      const lazy = n.type === 'blockquote' ? this.lazyQuoteHtml(n) : n.type === 'footnoteDefinition' ? this.lazyFootnoteHtml(n) : null;
      if (lazy) {
        // cmark ends the quote (or footnote) at an HTML line it doesn't continue, which
        // micromark reads into it.
        const quote = this.block(lazy.quote);
        if (quote) blocks.push({ node: quote, lines: [start, Math.max(start, this.contentEndLine(lazy.quote))] });
        const html: MarkdownNode = { type: 'html', value: blockValue(lazy.html.value) };
        this.hoisted.add(html);
        const lines: [number, number] = [lazy.html.position!.start.line, this.contentEndLine(lazy.html, next)];
        sourceLines.set(html, lines);
        blocks.push({ node: html, lines });
        return;
      }
      const converted = this.block(n);
      if (converted === null) return;
      blocks.push({ node: converted, lines: [start, Math.max(start, this.contentEndLine(n, next))] });
    });
    // An HTML block hoisted out of a list is one cmark starts outside it, where a tag alone on
    // its line (type 7) runs to the next blank line: the lines micromark read as blocks of their
    // own after it are its text. A block running on past the blank line is parsed again from there.
    for (let i = 0; i < blocks.length; i++) {
      const a = blocks[i];
      if (a.node.type !== 'html' || !this.hoisted.has(a.node)) continue;
      let end = a.lines[0];
      while (end < this.lines.length && !/^[ \t]*$/.test(this.lines[end])) end++;
      end = Math.max(end, a.lines[1]);
      let j = i + 1, rest = end;
      while (j < blocks.length && blocks[j].lines[0] <= end) rest = Math.max(rest, blocks[j++].lines[1]);
      if (j === i + 1) continue;
      const html: MarkdownNode = { type: 'html', value: this.lines.slice(a.lines[0] - 1, end).join('\n') };
      sourceLines.set(html, [a.lines[0], end]);
      const again = rest > end ? convert(this.lines.slice(end, rest).join('\n')) : { blocks: [], tasks: [] };
      const reparsed = again.blocks;
      for (const b of reparsed) {
        shiftLines(b.node, end);
        b.lines = [b.lines[0] + end, b.lines[1] + end];
      }
      // The tasks of the lines replaced give way to those parsed again.
      const kept = this.tasks.filter((t) => t.line < a.lines[0] || t.line > rest);
      const at = kept.findIndex((t) => t.line > rest);
      kept.splice(at < 0 ? kept.length : at, 0, ...again.tasks.map((t) => ({ line: t.line + end, column: t.column })));
      this.tasks = kept;
      blocks.splice(i, j - i, { node: html, lines: [a.lines[0], end] }, ...reparsed);
    }
    // Definitions nested in a container come right after the top-level block that holds them,
    // in source order by their first line (§3.2).
    for (const d of this.nestedDefinitions.sort((a, b) => a.line - b.line).reverse()) {
      blocks.splice(d.afterTop + 1, 0, { node: d.node, lines: [d.line, d.line] });
    }
    return { blocks, tasks: this.tasks };
  }

  // MARK: Blocks

  private blocks(nodes: AnyNode[]): MarkdownNode[] {
    return nodes.map((n) => this.block(n)).filter((n): n is MarkdownNode => n !== null);
  }

  private block(n: AnyNode, nested = false): MarkdownNode | null {
    const out = this.blockNode(n, nested);
    if (out && n.position) sourceLines.set(out, [n.position.start.line, Math.max(n.position.start.line, this.contentEndLine(n))]);
    return out;
  }

  private blockNode(n: AnyNode, nested: boolean): MarkdownNode | null {
    switch (n.type) {
      case 'paragraph':
        return { type: 'paragraph', blockId: null, children: this.inlines(n.children) };
      case 'heading':
        return { type: 'heading', depth: n.depth, children: this.inlines(n.children) };
      case 'thematicBreak':
        return { type: 'thematicBreak' };
      case 'blockquote':
        return { type: 'blockquote', blockId: null, children: this.containerChildren(n.children) };
      case 'list': {
        const items = n.children;
        return {
          type: 'list', ordered: !!n.ordered, start: n.ordered ? (n.start ?? 1) : null,
          spread: this.blankBetween(items), blockId: null,
          children: items.map((item) => this.block(item)!),
        };
      }
      case 'listItem':
        return this.listItem(n);
      case 'code': {
        // micromark's value already leaves out the last line ending: one still at the end is a
        // blank last line of the block, which cmark-gfm keeps too.
        const value = n.value.replace(/\r\n?/g, '\n');
        if (n.lang === MATH_INFO.split(' ')[0] || (n.lang ?? '') + (n.meta ? ' ' + n.meta : '') === MATH_INFO) {
          return { type: 'math', meta: null, value, blockId: null };
        }
        // cmark trims the info string after decoding it, then splits it at the first space or tab.
        const info = ((n.lang ?? '') + (n.meta ? ' ' + n.meta : '')).trim();
        const split = /[ \t]/.exec(info);
        const lang = info === '' ? null : split ? info.slice(0, split.index) : info;
        const meta = split ? info.slice(split.index + 1).replace(/^[ \t]+|[ \t]+$/g, '') || null : null;
        return { type: 'code', lang, meta, value, blockId: null };
      }
      case 'html':
        return { type: 'html', value: blockValue(n.value) };
      case 'table': {
        const columns = n.children[0]?.children.length ?? n.align?.length ?? 0;
        const align: Align[] = Array.from({ length: columns }, (_, i) => (n.align?.[i] ?? null) as Align);
        return {
          type: 'table', align, blockId: null,
          // GFM pads a short row with empty cells and drops extra ones (§3.2).
          children: n.children.map((row) => ({
            type: 'tableRow' as const,
            children: Array.from({ length: columns }, (_, i) => ({
              type: 'tableCell' as const,
              children: row.children[i] ? this.inlines(row.children[i].children) : [],
            })),
          })),
        };
      }
      case 'footnoteDefinition': {
        const label = n.label ?? n.identifier;
        // A definition no reference uses isn't part of the tree, as on GitHub (§3.2).
        // Nor is a second definition of a label (§3.2).
        if (!validFootnoteLabel(label) || !this.usedFootnotes.has(label.toLowerCase()) || this.firstFootnotes.get(label.toLowerCase()) !== n) return null;
        const node: MarkdownNode = { type: 'footnoteDefinition', identifier: label.toLowerCase(), label, children: this.containerChildren(n.children) };
        if (nested) {
          this.nestedDefinitions.push({ node, line: n.position!.start.line, afterTop: this.currentTop });
          return null;
        }
        return node;
      }
      case 'definition':
        return null;
      default:
        return null;
    }
  }

  /** Children of a container: footnote definitions inside it are lifted to the top level. */
  private containerChildren(nodes: AnyNode[]): MarkdownNode[] {
    return nodes.flatMap((n) => (n.type === 'list' ? this.listParts(n).map((p) => p.node) : [this.block(n, true)]))
      .filter((n): n is MarkdownNode => n !== null)
      .filter((n) => n.type !== 'footnoteDefinition');
  }

  /**
   * A list, as one list, or as more than one when an empty task item's next line is unindented
   * text. cmark-gfm takes the checkbox as part of the item's start, so the item is empty and that
   * line can't continue it: the list ends there, the line is a paragraph, and the items after it
   * make a new list. micromark reads the line as the item's paragraph continuing. Inside a quote
   * cmark-gfm doesn't see the box at all, and the item continues there too.
   */
  private listParts(n: Mdast.List): TopLevelBlock[] {
    const parts: TopLevelBlock[] = [];
    let items: { node: MarkdownNode; mdast: Mdast.ListItem }[] = [];
    const flush = () => {
      if (!items.length) return;
      const first = items[0].mdast, last = items[items.length - 1].mdast;
      const start = first.position!.start.line;
      const node: MarkdownNode = {
        type: 'list', ordered: !!n.ordered, start: n.ordered ? this.itemNumber(first) : null,
        spread: this.blankBetween(items.map((i) => i.mdast)), blockId: null, children: items.map((i) => i.node),
      };
      const end = items.length > 1 || last.children.length ? this.contentEndLine(last) : start;
      sourceLines.set(node, [start, Math.max(start, end)]);
      parts.push({ node, lines: [start, Math.max(start, end)] });
      items = [];
    };
    for (const item of n.children) {
      const outside = this.emptyTaskThenBlank(item);
      if (outside) {
        const line = item.position!.start.line;
        const empty: MarkdownNode = { type: 'listItem', checked: checkboxAt(this.source, item.position!.start.offset!), spread: false, children: [] };
        this.tasks.push({ line, column: item.position!.start.offset! - this.lineStarts[line - 1] });
        items.push({ node: empty, mdast: { ...item, children: [], position: { start: item.position!.start, end: item.position!.start } } as Mdast.ListItem });
        flush();
        parts.push(...outside);
        continue;
      }
      const hoisted = this.lazyHtml(item);
      if (hoisted) {
        // cmark ends the list at an unindented HTML line, which micromark reads into the item.
        const children = item.children.slice(0, -1);
        // The item ends where its last kept child does, not at the HTML.
        const end = children[children.length - 1]?.position?.end ?? item.position!.start;
        const kept = { ...item, children, position: { start: item.position!.start, end } } as Mdast.ListItem;
        items.push({ node: this.block(kept)!, mdast: kept });
        flush();
        const html: MarkdownNode = { type: 'html', value: blockValue(hoisted.value) };
        this.hoisted.add(html);
        const lines: [number, number] = [hoisted.position!.start.line, this.contentEndLine(hoisted)];
        sourceLines.set(html, lines);
        parts.push({ node: html, lines });
        continue;
      }
      const split = this.emptyTaskWithLazyLine(item);
      if (!split) { items.push({ node: this.block(item)!, mdast: item }); continue; }
      items.push({ node: split.item, mdast: { ...item, children: [] } as Mdast.ListItem });
      const lastItem = items[items.length - 1];
      flush();
      // The empty item is its marker's line alone.
      parts[parts.length - 1].lines[1] = Math.max(parts[parts.length - 1].lines[0], lastItem.mdast.position!.start.line);
      sourceLines.set(parts[parts.length - 1].node, parts[parts.length - 1].lines);
      const paragraph: MarkdownNode = { type: 'paragraph', blockId: null, children: split.lazy };
      const lines: [number, number] = [item.position!.start.line + 1, this.contentEndLine(item)];
      sourceLines.set(paragraph, lines);
      parts.push({ node: paragraph, lines });
    }
    flush();
    return parts;
  }

  /**
   * An item's last child when it's an HTML block on a line not indented to the item's content: a
   * closing or open tag alone on a line, which can't interrupt the item's paragraph, so micromark
   * reads it into the item. cmark-gfm doesn't match the item's container there, sees an HTML
   * block start, and ends the list.
   */
  /**
   * A quote (or a quote's last quote) whose last block is HTML on a line with no `>`: the quote
   * without it, and the HTML. Like `lazyHtml` for lists: cmark ends the quote there.
   */
  private lazyQuoteHtml(quote: Mdast.Blockquote): { quote: Mdast.Blockquote; html: Mdast.Html } | null {
    const last = quote.children[quote.children.length - 1];
    if (quote.children.length < 2 && last?.type !== 'blockquote') return null;
    let html: Mdast.Html, kept: Mdast.Blockquote['children'];
    if (last?.type === 'blockquote') {
      const inner = this.lazyQuoteHtml(last);
      if (!inner) return null;
      html = inner.html;
      kept = [...quote.children.slice(0, -1), inner.quote];
    } else {
      if (last?.type !== 'html' || /^ {0,3}>/.test(this.lines[last.position!.start.line - 1] ?? '')) return null;
      html = last;
      kept = quote.children.slice(0, -1);
    }
    const end = kept[kept.length - 1]?.position?.end ?? quote.position!.start;
    return { quote: { ...quote, children: kept, position: { start: quote.position!.start, end } }, html };
  }

  /**
   * Reference definitions right after a task's box (`- [ ] [r]: /u`). Where cmark-gfm sees the
   * box as the item opens (`sees`), it takes it out of the paragraph, whose text then starts with
   * the definitions, and they define `r` for the whole page. micromark reads them as text.
   * Returns the definitions' source and what's left of the paragraph (null for nothing).
   */
  private boxDefinitions(item: Mdast.ListItem): { raw: string[]; paragraph: Mdast.Paragraph | null } | null {
    const offset = item.position!.start.offset!;
    const para = item.children[0];
    if (para?.type !== 'paragraph' || checkboxAt(this.source, offset) === null || !this.sees(item)) return null;
    let from = checkboxOffset(this.source, offset)! + 2;
    while (this.source[from] === ' ' || this.source[from] === '\t') from++;
    if (this.source[from] !== '[') return null;
    const found = leadingDefinitions(this.source.slice(from, para.position!.end.offset));
    if (!found) return null;
    const cut = from + found.rest;
    if (cut >= para.position!.end.offset!) return { raw: found.raw, paragraph: null };
    const kept: Mdast.PhrasingContent[] = [];
    for (const child of para.children) {
      const start = child.position!.start.offset!, end = child.position!.end.offset!;
      if (start >= cut) kept.push(child);
      else if (end > cut && child.type === 'text') {
        // The definitions end a line: the text keeps the lines after them.
        const endings = (this.source.slice(start, cut).match(/\r\n|\r|\n/g) ?? []).length;
        const value = child.value.split(/\r\n|\r|\n/).slice(endings).join('\n');
        // A lazy line keeps its indentation (`afterDefinitions`); micromark's text has none.
        const line = child.position!.start.line + endings;
        const space = this.parse.lazy[line] ? /^[ \t]*/.exec(this.lines[line - 1])![0] : '';
        if (value) kept.push({ ...child, value: space + value.replace(/^[ \t]+/, '') });
      }
    }
    return { raw: found.raw, paragraph: kept.length ? { ...para, children: kept } : null };
  }

  /** The source of every definition right after a task's box (`boxDefinitions`), in page order. */
  hiddenDefinitions(): string[] {
    const raw: string[] = [];
    const visit = (n: AnyNode) => {
      // `[^1]: x` there is a link definition for `^1` to cmark, which micromark would read as a
      // footnote's: left out, so `[^1]` stays a footnote reference.
      if (n.type === 'listItem') raw.push(...(this.boxDefinitions(n)?.raw ?? []).filter((d) => !d.startsWith('[^')));
      if ('children' in n) for (const c of n.children as AnyNode[]) visit(c);
    };
    visit(this.tree);
    return raw;
  }

  /** A footnote definition whose last block is HTML on a line indented less than four: the same as `lazyQuoteHtml`. */
  private lazyFootnoteHtml(note: Mdast.FootnoteDefinition): { quote: Mdast.FootnoteDefinition; html: Mdast.Html } | null {
    const last = note.children[note.children.length - 1];
    if (note.children.length < 2 || last?.type !== 'html' || indentWidth(this.lines[last.position!.start.line - 1] ?? '') >= 4) return null;
    const kept = note.children.slice(0, -1);
    const copy: Mdast.FootnoteDefinition = { ...note, children: kept, position: { start: note.position!.start, end: kept[kept.length - 1].position!.end } };
    // The copy stands for the definition: it's the label's first if the original was.
    const key = (note.label ?? note.identifier).toLowerCase();
    if (this.firstFootnotes.get(key) === note) this.firstFootnotes.set(key, copy);
    return { quote: copy, html: last };
  }

  /**
   * An empty task (`- [ ] `) followed by a blank line: like any item that starts empty, cmark
   * ends it at the blank, so the indented lines after it aren't the item's but blocks after the
   * list. micromark gives them to the item. Returns those blocks, parsed on their own.
   */
  private emptyTaskThenBlank(item: Mdast.ListItem): TopLevelBlock[] | null {
    const offset = item.position!.start.offset!;
    const line = item.position!.start.line;
    if (item.position!.end.line <= line + 1 || checkboxAt(this.source, offset) === null || !this.sees(item)) return null;
    const at = checkboxOffset(this.source, offset)!;
    const lineEnd = this.lineStarts[line - 1] + this.lines[line - 1].length;
    if (!/^[ \t\v\f]+$/.test(this.source.slice(at + 2, lineEnd)) || !/^[ \t]*$/.test(this.lines[line])) return null;
    // The lines belong to the list's container, which starts where the marker does.
    const column = columnAt(this.lines[line - 1], offset - this.lineStarts[line - 1]);
    const removed: number[] = [];
    const rest = this.lines.slice(line, item.position!.end.line).map((text) => {
      let k = 0;
      while (k < text.length && (text[k] === ' ' || text[k] === '\t') && columnAt(text, k + 1) <= column) k++;
      removed.push(k);
      return text.slice(k);
    });
    const nested = convert(rest.join('\n'));
    for (const t of nested.tasks) this.tasks.push({ line: t.line + line, column: t.column + (removed[t.line - 1] ?? 0) });
    return nested.blocks.map((b) => {
      shiftLines(b.node, line);
      return { node: b.node, lines: [b.lines[0] + line, b.lines[1] + line] };
    });
  }

  /** The column an item's content starts at (tabs to multiples of four), from its marker line. */
  private contentColumn(item: Mdast.ListItem): number | null {
    const line = item.position!.start.line;
    const text = this.lines[line - 1];
    const index = item.position!.start.offset! - this.lineStarts[line - 1];
    const marker = /^(?:[-+*]|\d{1,9}[.)])/.exec(text.slice(index))?.[0];
    if (!marker) return null;
    const after = columnAt(text, index + marker.length);
    const space = /^[ \t]*/.exec(text.slice(index + marker.length))![0];
    const width = columnAt(text, index + marker.length + space.length) - after;
    return after + (width >= 1 && width <= 4 ? width : 1);
  }

  private lazyHtml(item: Mdast.ListItem): Mdast.Html | null {
    const last = item.children[item.children.length - 1];
    if (last?.type !== 'html' || item.children.length < 2 || this.quoteDepth(item) > 0) return null;
    const contentColumn = this.contentColumn(item);
    if (contentColumn === null) return null;
    return indentWidth(this.lines[last.position!.start.line - 1] ?? '') < contentColumn ? last : null;
  }

  /** An ordered item's own number, from the source. */
  private itemNumber(item: Mdast.ListItem): number {
    return Number(/^\d+/.exec(this.source.slice(item.position!.start.offset!))?.[0] ?? 1);
  }

  /** For an empty task whose next line is unindented text: the task, and that text's inlines. */
  private emptyTaskWithLazyLine(item: Mdast.ListItem): { item: MarkdownNode; lazy: MarkdownNode[] } | null {
    if (this.quoteDepth(item) > 0 || item.children.length !== 1) return null;
    const offset = item.position!.start.offset!;
    const box = checkboxAt(this.source, offset);
    const first = item.children[0];
    const line = item.position!.start.line;
    // The item's paragraph runs on to the next line…
    if (box === null || first.type !== 'paragraph' || first.position!.end.line <= line) return null;
    // …while the box ends its own line…
    const at = checkboxOffset(this.source, offset)!;
    const lineEnd = this.lineStarts[line - 1] + this.lines[line - 1].length;
    // cmark's `scan_tasklist` wants a space after the box: `- [ ]` alone is the text `[ ]`.
    if (!/^[ \t\v\f]+$/.test(this.source.slice(at + 2, lineEnd))) return null;
    // …and that next line isn't indented to the item's content, so it can't be the item's.
    const next = this.lines[line] ?? '';
    if (/^[ \t]*$/.test(next) || indentWidth(next) >= this.contentColumn(item)!) return null;
    let inline = this.inlines(first.children);
    // micromark may or may not have taken the box as a task's; drop it if it's still text.
    if (inline[0]?.type === 'text' && /^\[[ xX]\][ \t]*\n/.test(inline[0].value)) {
      const rest = inline[0].value.slice(inline[0].value.indexOf('\n') + 1).replace(/^[ \t]+/, '');
      inline = mergeText([...(rest ? [{ type: 'text' as const, value: rest }] : []), ...inline.slice(1)]);
    } else if (inline[0]?.type === 'break') {
      // Two spaces after the box, then the line ending: still the box's, not a hard break.
      inline = inline.slice(1);
    } else if (inline[0]?.type === 'text' && /^[ \t]*\n/.test(inline[0].value)) {
      // Taken as a task's, the box leaves the line ending after it (`\r\n` among them).
      const rest = inline[0].value.replace(/^[ \t]*\n[ \t]*/, '');
      inline = mergeText([...(rest ? [{ type: 'text' as const, value: rest }] : []), ...inline.slice(1)]);
    }
    this.tasks.push({ line, column: offset - this.lineStarts[line - 1] });
    return { item: { type: 'listItem', checked: box, spread: false, children: [] }, lazy: inline };
  }

  /**
   * Whether an item is the first container on its line, outside any blockquote: the only place
   * cmark-gfm sees an empty task's box (`- [ ] ` with nothing after it). In a quote, or nested on
   * the line of another item (`1. - [ ] `), the box is the item's text.
   */
  private sees(item: Mdast.ListItem): boolean {
    if (this.quoteDepth(item) > 0) return false;
    const line = item.position!.start.line;
    return /^[ \t]*$/.test(this.lines[line - 1].slice(0, item.position!.start.offset! - this.lineStarts[line - 1]));
  }

  /**
   * An empty task whose box (and a space) ends its line, with more of the item on the lines after: cmark-gfm
   * reads the box as the task's, so those lines are the item's own blocks, never text continuing
   * `[ ]` (a `-` under it is an empty item, not a setext underline). They're parsed on their own,
   * dedented to the item's content.
   */
  private emptyTaskWithBlocks(item: Mdast.ListItem): MarkdownNode[] | null {
    const offset = item.position!.start.offset!;
    const line = item.position!.start.line;
    const end = item.position!.end.line;
    if (end <= line || checkboxAt(this.source, offset) === null || !this.sees(item)) return null;
    const at = checkboxOffset(this.source, offset)!;
    const lineEnd = this.lineStarts[line - 1] + this.lines[line - 1].length;
    // cmark's `scan_tasklist` wants a space after the box: `- [ ]` alone is the text `[ ]`.
    if (!/^[ \t\v\f]+$/.test(this.source.slice(at + 2, lineEnd))) return null;
    return this.blocksAfterBox(item, null);
  }

  /**
   * A task whose text after the box, with the line under it, makes a table's header and delimiter
   * rows. cmark-gfm takes the box out first; micromark counts it as a header cell, so the columns
   * don't match and there's no table. The item's blocks, parsed again without the box.
   */
  private taskTable(item: Mdast.ListItem): MarkdownNode[] | null {
    const offset = item.position!.start.offset!;
    const line = item.position!.start.line;
    const para = item.children[0];
    if (para?.type !== 'paragraph' || para.position!.end.line <= line || checkboxAt(this.source, offset) === null || !this.sees(item)) return null;
    let from = checkboxOffset(this.source, offset)! + 2;
    while (this.source[from] === ' ' || this.source[from] === '\t') from++;
    const head = this.source.slice(from, this.lineStarts[line - 1] + this.lines[line - 1].length);
    const next = (this.lines[line] ?? '').replace(/^[ \t]+/, '');
    if (!isDelimiterRow(next) || rowCells(head) !== rowCells(next)) return null;
    return this.blocksAfterBox(item, head);
  }

  /**
   * An item's lines after its marker line, dedented to its content, parsed on their own as its
   * blocks; `first` is the marker line's text after the box, when that's to be parsed too.
   */
  private blocksAfterBox(item: Mdast.ListItem, first: string | null): MarkdownNode[] {
    const offset = item.position!.start.offset!;
    const line = item.position!.start.line;
    const end = item.position!.end.line;
    const column = offset - this.lineStarts[line - 1];
    const marker = /^(?:[-+*]|\d{1,9}[.)])/.exec(this.lines[line - 1].slice(column))![0];
    const contentColumn = column + marker.length + 1;
    const removed: number[] = first === null ? [] : [0];
    const rest = this.lines.slice(line, end).map((text) => {
      let cols = 0;
      let k = 0;
      while (k < text.length && cols < contentColumn && (text[k] === ' ' || text[k] === '\t')) {
        cols += text[k] === '\t' ? 4 - (cols % 4) : 1;
        k++;
      }
      removed.push(k);
      return text.slice(k);
    });
    const nested = convert([...(first === null ? [] : [first]), ...rest].join('\n'));
    const shift = first === null ? line : line - 1;
    for (const block of nested.blocks) shiftLines(block.node, shift);
    for (const t of nested.tasks) this.tasks.push({ line: t.line + shift, column: t.column + (removed[t.line - 1] ?? 0) });
    return nested.blocks.map((b) => b.node);
  }

  private listItem(item: Mdast.ListItem): MarkdownNode {
    const offset0 = item.position!.start.offset!;
    const boxed = this.emptyTaskWithBlocks(item) ?? this.taskTable(item);
    if (boxed) {
      const line = item.position!.start.line;
      const box = checkboxAt(this.source, offset0)!;
      this.tasks.push({ line, column: offset0 - this.lineStarts[line - 1] });
      return { type: 'listItem', checked: box, spread: this.blankBetween(item.children), children: boxed };
    }
    const defined = this.boxDefinitions(item);
    if (defined) {
      const rest = [...(defined.paragraph ? [defined.paragraph] : []), ...item.children.slice(1)];
      const line = item.position!.start.line;
      this.tasks.push({ line, column: offset0 - this.lineStarts[line - 1] });
      return { type: 'listItem', checked: checkboxAt(this.source, offset0), spread: this.blankBetween(rest), children: this.containerChildren(rest) };
    }
    let children = this.containerChildren(item.children);
    // The checkbox comes from the source, as AtlasKit reads it: micromark misses an empty task
    // (`- [ ] `), reading it as a plain item whose text is `[ ]` (§3.3).
    const offset = item.position!.start.offset!;
    const box = checkboxAt(this.source, offset);
    let checked: boolean | null = null;
    const para = children[0];
    if (box === null && item.checked !== null && item.checked !== undefined && para?.type === 'paragraph') {
      // micromark takes a box the line ends right after (`- [ ]⏎x`) as a task's. cmark-gfm wants
      // a space after it, so the box is the paragraph's text, with the line it continues onto.
      const at = checkboxOffset(this.source, offset)!;
      const lead = para.children[0];
      const rest = lead?.type === 'text' ? [{ ...lead, value: lead.value.replace(/^[ \t]*(?:\r\n|\r|\n)?[ \t]*/, '') }, ...para.children.slice(1)] : para.children;
      children = [{ ...para, children: mergeText([{ type: 'text', value: this.source.slice(at - 1, at + 2) + '\n' }, ...rest]) }, ...children.slice(1)];
    }
    if (box !== null) {
      if (item.checked !== null && item.checked !== undefined) {
        checked = box;
        // The text after the box starts the item's paragraph, whose leading whitespace CommonMark
        // strips; micromark keeps what follows the one space it takes with the box.
        const first = children[0];
        if (first?.type === 'paragraph' && first.children[0]?.type === 'text') {
          const text = first.children[0].value.replace(/^[ \t]+/, '');
          const inline = text ? [{ type: 'text' as const, value: text }, ...first.children.slice(1)] : first.children.slice(1);
          children = [{ ...first, children: inline }, ...children.slice(1)];
        }
      } else {
        const first = children[0];
        if (first?.type === 'paragraph' && first.children[0]?.type === 'text') {
          const text = first.children[0].value;
          const marker = /^\[[ xX]\]([ \t]+|$)/.exec(text);
          // Nothing after the box: a task only where cmark-gfm sees the box (`sees`).
          if (marker && (marker[1] !== '' || (first.children.length === 1 && this.sees(item)))) {
            checked = box;
            const rest = text.slice(marker[0].length);
            const inline = rest ? [{ type: 'text' as const, value: rest }, ...first.children.slice(1)] : first.children.slice(1);
            children = inline.length ? [{ ...first, children: inline }, ...children.slice(1)] : children.slice(1);
          }
        } else if ((first?.type === 'heading' || first?.type === 'table') && this.sees(item)) {
          // Where cmark-gfm sees the box as the item opens (`sees`), it takes it out of the
          // paragraph before that becomes a setext heading or a table's header row; micromark
          // leaves it in the text.
          const strip = (inline: MarkdownNode[]): MarkdownNode[] | null => {
            const lead = inline[0];
            const marker = lead?.type === 'text' ? /^\[[ xX]\][ \t]+/.exec(lead.value) : null;
            if (!marker || lead.type !== 'text') return null;
            const rest = lead.value.slice(marker[0].length);
            return rest ? [{ type: 'text', value: rest }, ...inline.slice(1)] : inline.slice(1);
          };
          if (first.type === 'heading') {
            const inline = strip(first.children);
            if (inline) { checked = box; children = [{ ...first, children: inline }, ...children.slice(1)]; }
          } else {
            const [row, ...rows] = first.children;
            const [cell, ...cells] = row?.type === 'tableRow' ? row.children : [];
            const inline = cell?.type === 'tableCell' ? strip(cell.children) : null;
            if (inline && row?.type === 'tableRow' && cell?.type === 'tableCell') {
              checked = box;
              children = [{ ...first, children: [{ ...row, children: [{ ...cell, children: inline }, ...cells] }, ...rows] }, ...children.slice(1)];
            }
          }
        }
      }
    }
    if (checked !== null) {
      const line = item.position!.start.line;
      this.tasks.push({ line, column: offset - this.lineStarts[line - 1] });
    }
    return { type: 'listItem', checked, spread: this.blankBetween(item.children), children };
  }

  // MARK: Inlines

  private inlines(nodes: AnyNode[], inLink = false): MarkdownNode[] {
    const out: MarkdownNode[] = [];
    for (const n of nodes) out.push(...this.inline(n));
    const merged = mergeText(out);
    return inLink ? merged : emailAutolinks(merged);
  }

  private inline(n: AnyNode): MarkdownNode[] {
    switch (n.type) {
      case 'text':
        return [{ type: 'text', value: n.value.replace(/\r\n?/g, '\n') }];
      case 'break':
        return [{ type: 'break' }];
      case 'inlineCode':
        return [{ type: 'inlineCode', value: this.codeSpanValue(n) }];
      case 'html':
        return [{ type: 'html', value: n.value }];
      case 'emphasis':
        return [{ type: 'emphasis', children: this.inlines(n.children) }];
      case 'strong':
        return [{ type: 'strong', children: this.inlines(n.children) }];
      case 'delete':
        return [{ type: 'delete', children: this.inlines(n.children) }];
      case 'link':
        return [{ type: 'link', url: n.url, title: n.title ?? null, children: this.inlines(n.children, true) }];
      case 'image':
        return [{ type: 'image', url: n.url, title: n.title ?? null, alt: n.alt ?? '' }];
      case 'linkReference': {
        // References are resolved (§3.2): the link carries its definition's url and title.
        const def = this.definitions.get(n.identifier);
        if (!def) return this.literalSource(n);
        return [{ type: 'link', url: def.url, title: def.title, children: this.inlines(n.children, true) }];
      }
      case 'imageReference': {
        const def = this.definitions.get(n.identifier);
        if (!def) return this.literalSource(n);
        return [{ type: 'image', url: def.url, title: def.title, alt: n.alt ?? '' }];
      }
      case 'footnoteReference': {
        const label = n.label ?? n.identifier;
        if (!validFootnoteLabel(label)) return this.literalSource(n);
        return [{ type: 'footnoteReference', identifier: label.toLowerCase(), label }];
      }
      default:
        return this.literalSource(n);
    }
  }

  /** A construct the tree doesn't keep, as its source text. */
  private literalSource(n: AnyNode): MarkdownNode[] {
    const p = n.position;
    if (!p?.start.offset === undefined || p?.end.offset === undefined) return [];
    return [{ type: 'text', value: this.source.slice(p!.start.offset!, p!.end.offset).replace(/\r\n?/g, '\n') }];
  }

  /**
   * A code span's value as CommonMark defines it (§3.1): line endings become spaces. A continuation
   * line's leading whitespace was already stripped with the paragraph's lines, which micromark
   * keeps in code spans (§3.3), except a lazy line's, which cmark keeps. Then one space comes off
   * each end.
   */
  private codeSpanValue(n: Mdast.InlineCode): string {
    // A line ending is a space, and the next line's indentation goes, unless the line is lazy:
    // cmark keeps a lazy line's whitespace.
    let line = n.position!.start.line;
    const value = n.value.replace(/(?:\r\n|\r|\n)([ \t]*)/g, (_, space: string) => (this.parse.lazy[++line] ? ' ' + space : ' '));
    // Then one space off each end, when both have one and there's more than spaces (`atlasCodeSpans`).
    return value.length > 1 && value.startsWith(' ') && value.endsWith(' ') && /[^ ]/.test(value) ? value.slice(1, -1) : value;
  }

  // MARK: Lines

  /**
   * Whether a blank line separates any two consecutive nodes (mdast's `spread`, §3.2). Reference
   * definitions don't count: cmark has removed their paragraph before it judges a list loose.
   */
  private blankBetween(all: AnyNode[]): boolean {
    const nodes = all.filter((n) => n.type !== 'definition');
    for (let i = 0; i + 1 < nodes.length; i++) {
      const next = nodes[i + 1].position!.start.line;
      if (next > this.contentEndLine(nodes[i], next) + 1) return true;
    }
    return false;
  }

  /**
   * The last line a node's content is on: its end clamped to before the next sibling, then
   * stepped back over blank lines, except in a fenced code block that is never closed, whose
   * trailing blank lines are its content.
   */
  contentEndLine(n: AnyNode, nextStart?: number): number {
    let end = n.position!.end.line;
    // micromark ends a node after its last line ending when the next line is blank or the end.
    if (n.position!.end.column === 1 && end > n.position!.start.line) end -= 1;
    if (nextStart !== undefined) end = Math.min(end, nextStart - 1);
    const start = n.position!.start.line;
    if (n.type === 'code' && this.isUnclosedFence(n)) return end;
    const depth = this.quoteDepth(n);
    while (end > start && this.isBlank(end, depth)) end--;
    return end;
  }

  private isUnclosedFence(n: Mdast.Code): boolean {
    const first = this.lines[n.position!.start.line - 1] ?? '';
    const fence = /^(?:\s*>)*\s*(`{3,}|~{3,})/.exec(first);
    if (!fence) return false;
    const last = this.lines[n.position!.end.line - 1] ?? '';
    const close = new RegExp(`^(?:\\s*>)*\\s*${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
    return n.position!.end.line === n.position!.start.line || !close.test(last);
  }

  private depths = new WeakMap<object, number>();
  private quoteDepth(n: AnyNode): number {
    if (!this.depths.has(this.tree)) this.indexDepths(this.tree, 0);
    return this.depths.get(n) ?? 0;
  }
  private indexDepths(n: AnyNode, depth: number): void {
    this.depths.set(n, depth);
    const inner = n.type === 'blockquote' ? depth + 1 : depth;
    if ('children' in n) for (const c of n.children as AnyNode[]) this.indexDepths(c, inner);
  }

  /** Whether a 1-based line is blank inside `depth` blockquotes: empty once that many `>` are stripped. */
  private isBlank(line: number, depth: number): boolean {
    if (line < 1 || line > this.lines.length) return true;
    let rest = this.lines[line - 1];
    for (let i = 0; i < depth; i++) {
      rest = rest.replace(/^[ \t]*/, '');
      if (!rest.startsWith('>')) break;
      rest = rest.slice(1);
    }
    return /^[ \t]*$/.test(rest);
  }
}

/** SPEC §3.2: a footnote label is one or more letters, digits, `-` or `_`. */
export function validFootnoteLabel(label: string): boolean {
  return /^[\p{L}\p{N}_-]+$/u.test(label);
}

/** The value of a code, math or html block: `\n` line endings, without a trailing one (§3.2). */
function blockValue(s: string): string {
  const v = s.replace(/\r\n?/g, '\n');
  return v.endsWith('\n') ? v.slice(0, -1) : v;
}

export function mergeText(kids: MarkdownNode[]): MarkdownNode[] {
  const out: MarkdownNode[] = [];
  for (const kid of kids) {
    if (kid.type === 'text') {
      if (kid.value === '') continue;
      const last = out[out.length - 1];
      if (last?.type === 'text') { out[out.length - 1] = { type: 'text', value: last.value + kid.value }; continue; }
    }
    out.push(kid);
  }
  return out;
}

/**
 * The checkbox of a task item whose list marker starts at `offset`: the marker, spaces or tabs,
 * then `[ ]`, `[x]` or `[X]` followed by a space or tab (or the end of the line, for an empty
 * task). Null when there is none.
 */
export function checkboxAt(source: string, offset: number): boolean | null {
  const at = checkboxOffset(source, offset);
  if (at === null) return null;
  const after = source[at + 2];
  if (after !== ' ' && after !== '\t') return null;
  return source[at] !== ' ';
}

/** The UTF-16 offset of the character between a task's brackets, given its list marker's offset. */
export function checkboxOffset(source: string, offset: number): number | null {
  let i = offset;
  if (source[i] >= '0' && source[i] <= '9') {
    while (source[i] >= '0' && source[i] <= '9') i++;
    if (source[i] !== '.' && source[i] !== ')') return null;
  } else if (!'-+*'.includes(source[i] ?? '\u0000')) {
    return null;
  }
  i++;
  while (source[i] === ' ' || source[i] === '\t') i++;
  if (source[i] !== '[' || source[i + 2] !== ']' || !' xX'.includes(source[i + 1] ?? '\u0000')) return null;
  return i + 1;
}

/** The column of `text[index]`, a tab running to the next multiple of four. */
function columnAt(text: string, index: number): number {
  let col = 0;
  for (let k = 0; k < index; k++) col = text[k] === '\t' ? col + 4 - (col % 4) : col + 1;
  return col;
}

/** How wide a line's indentation is, in columns. */
const indentWidth = (text: string) => columnAt(text, /^[ \t]*/.exec(text)![0].length);

/** Moves a tree's recorded source lines down by `delta`, for blocks parsed out of a part of the page. */
function shiftLines(node: MarkdownNode, delta: number): void {
  const lines = sourceLines.get(node);
  if (lines) sourceLines.set(node, [lines[0] + delta, lines[1] + delta]);
  const id = standaloneIdLine.get(node);
  if (id !== undefined) standaloneIdLine.set(node, id + delta);
  if ('children' in node) for (const c of node.children) shiftLines(c, delta);
}

export { flankingText };
