import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTaskListItemFromMarkdown } from 'mdast-util-gfm-task-list-item';
import { gfmFootnote } from 'micromark-extension-gfm-footnote';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item';
import { atlasAttention } from './attention';
import { atlasAutolinks, atlasAutolinksFromMarkdown, emailAutolinks } from './autolinks';
import { atlasContainers } from './containers';
import type * as Mdast from 'mdast';
import { MATH_INFO, splitLines } from './preprocess';
import type { Align, MarkdownNode } from './tree';
import { flankingText, sourceLines } from './tree';

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
  // GFM (§2) without micromark's autolinking: cmark-gfm's, as AtlasKit runs it, instead.
  const tree = fromMarkdown(source, {
    extensions: [gfmFootnote(), gfmStrikethrough(), gfmTable(), gfmTaskListItem(), atlasAutolinks(), atlasAttention(source), atlasContainers()],
    mdastExtensions: [gfmFootnoteFromMarkdown(), gfmStrikethroughFromMarkdown(), gfmTableFromMarkdown(), gfmTaskListItemFromMarkdown(), atlasAutolinksFromMarkdown()],
  });
  return new Converter(source, tree).run();
}

class Converter {
  private lines: string[];
  /** UTF-16 offset of each line's start, 0-based by line index. */
  private lineStarts: number[] = [];
  private definitions = new Map<string, { url: string; title: string | null }>();
  /** Footnote labels some reference uses (lowercased), and every valid definition seen. */
  private usedFootnotes = new Set<string>();
  private tasks: { line: number; column: number }[] = [];
  /** Footnote definitions found inside containers, lifted to the top level (§3.2). */
  private nestedDefinitions: { node: MarkdownNode; line: number; afterTop: number }[] = [];
  private currentTop = 0;
  /** HTML blocks moved out of a list item (`lazyHtml`). */
  private hoisted = new WeakSet<object>();

  constructor(private source: string, private tree: Mdast.Root) {
    const split = splitLines(source);
    this.lines = split.map((l) => l.content);
    let offset = 0;
    for (const l of split) { this.lineStarts.push(offset); offset += l.content.length + l.ending.length; }
    this.collect(tree);
  }

  /** Definitions (for resolving references) and the footnotes references use. */
  private collect(node: AnyNode): void {
    if (node.type === 'definition' && !this.definitions.has(node.identifier)) {
      this.definitions.set(node.identifier, { url: node.url, title: node.title ?? null });
    }
    if (node.type === 'footnoteReference' && validFootnoteLabel(node.label ?? node.identifier)) {
      this.usedFootnotes.add((node.label ?? node.identifier).toLowerCase());
    }
    if ('children' in node) for (const c of node.children as AnyNode[]) this.collect(c);
  }

  run(): Conversion {
    const top = this.tree.children.filter((n) => n.type !== 'definition');
    const blocks: TopLevelBlock[] = [];
    top.forEach((n, i) => {
      this.currentTop = blocks.length;
      const start = n.position!.start.line;
      const next = top[i + 1]?.position?.start.line;
      if (n.type === 'list') { blocks.push(...this.listParts(n)); return; }
      const converted = this.block(n);
      if (converted === null) return;
      blocks.push({ node: converted, lines: [start, Math.max(start, this.contentEndLine(n, next))] });
    });
    // An HTML block hoisted out of a list runs on into one on the very next line, as one block.
    for (let i = blocks.length - 2; i >= 0; i--) {
      const a = blocks[i], b = blocks[i + 1];
      if (a.node.type === 'html' && b.node.type === 'html' && b.lines[0] === a.lines[1] + 1 && this.hoisted.has(a.node)) {
        const merged: MarkdownNode = { type: 'html', value: a.node.value + '\n' + b.node.value };
        sourceLines.set(merged, [a.lines[0], b.lines[1]]);
        blocks.splice(i, 2, { node: merged, lines: [a.lines[0], b.lines[1]] });
      }
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
        const value = blockValue(n.value);
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
        if (!validFootnoteLabel(label) || !this.usedFootnotes.has(label.toLowerCase())) return null;
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
      const hoisted = this.lazyHtml(item);
      if (hoisted) {
        // cmark ends the list at an unindented HTML line, which micromark reads into the item.
        const kept = { ...item, children: item.children.slice(0, -1) } as Mdast.ListItem;
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
  private lazyHtml(item: Mdast.ListItem): Mdast.Html | null {
    const last = item.children[item.children.length - 1];
    if (last?.type !== 'html' || item.children.length < 2 || this.quoteDepth(item) > 0) return null;
    const offset = item.position!.start.offset!;
    const line = item.position!.start.line;
    const markerLine = this.lines[line - 1];
    const column = offset - this.lineStarts[line - 1];
    const marker = /^(?:[-+*]|\d{1,9}[.)])/.exec(markerLine.slice(column))?.[0];
    if (!marker) return null;
    const spaces = /^[ \t]*/.exec(markerLine.slice(column + marker.length))![0].length;
    const contentColumn = column + marker.length + (spaces >= 1 && spaces <= 4 ? spaces : 1);
    const htmlLine = this.lines[last.position!.start.line - 1] ?? '';
    return /^ */.exec(htmlLine)![0].length < contentColumn ? last : null;
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
    if (!/^[ \t]*$/.test(this.source.slice(at + 2, lineEnd))) return null;
    // …and that next line isn't indented to the item's content, so it can't be the item's.
    const markerLine = this.lines[line - 1];
    const column = offset - this.lineStarts[line - 1];
    const marker = /^(?:[-+*]|\d{1,9}[.)])/.exec(markerLine.slice(column))![0];
    const spaces = /^[ \t]*/.exec(markerLine.slice(column + marker.length))![0].length;
    const contentColumn = column + marker.length + (spaces >= 1 && spaces <= 4 ? spaces : 1);
    const next = this.lines[line] ?? '';
    if (/^[ \t]*$/.test(next) || /^ */.exec(next)![0].length >= contentColumn) return null;
    let inline = this.inlines(first.children);
    // micromark may or may not have taken the box as a task's; drop it if it's still text.
    if (inline[0]?.type === 'text' && /^\[[ xX]\][ \t]*\n/.test(inline[0].value)) {
      const rest = inline[0].value.slice(inline[0].value.indexOf('\n') + 1).replace(/^[ \t]+/, '');
      inline = mergeText([...(rest ? [{ type: 'text' as const, value: rest }] : []), ...inline.slice(1)]);
    }
    this.tasks.push({ line, column });
    return { item: { type: 'listItem', checked: box, spread: false, children: [] }, lazy: inline };
  }

  private listItem(item: Mdast.ListItem): MarkdownNode {
    let children = this.containerChildren(item.children);
    // The checkbox comes from the source, as AtlasKit reads it: micromark misses an empty task
    // (`- [ ] `), reading it as a plain item whose text is `[ ]` (§3.3).
    const offset = item.position!.start.offset!;
    const box = checkboxAt(this.source, offset);
    let checked: boolean | null = null;
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
          if (marker && (marker[1] !== '' || first.children.length === 1)) {
            checked = box;
            const rest = text.slice(marker[0].length);
            const inline = rest ? [{ type: 'text' as const, value: rest }, ...first.children.slice(1)] : first.children.slice(1);
            children = inline.length ? [{ ...first, children: inline }, ...children.slice(1)] : children.slice(1);
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
   * keeps in code spans (§3.3). micromark has already stripped one space from each end.
   */
  private codeSpanValue(n: Mdast.InlineCode): string {
    return n.value.replace(/(?:\r\n|\r|\n)[ \t]*/g, ' ');
  }

  // MARK: Lines

  /** Whether a blank line separates any two consecutive nodes (mdast's `spread`, §3.2). */
  private blankBetween(nodes: AnyNode[]): boolean {
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

export { flankingText };
