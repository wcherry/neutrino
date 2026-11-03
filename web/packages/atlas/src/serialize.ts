import { parse } from './parse';
import { longestRun } from './preprocess';
import { inlineMathAt } from './preprocess';
import { childrenOf, flankingText, type Align, type MarkdownNode, type WikiLinkReference } from './tree';

/**
 * Writes a tree in canonical form (SPEC §8.3); parsing the result gives the same tree back
 * (§8.4). Output uses `\n` and ends with exactly one. A port of AtlasKit's `CanonicalSerializer`.
 */
export function serializeCanonical(root: MarkdownNode): string {
  const blocks = childrenOf(root);
  const written: string[] = [];
  blocks.forEach((block, i) => {
    written.push(serializeBlock(block, i > 0 ? blocks[i - 1] : null, written[written.length - 1] ?? null, i === 0).text);
  });
  return written.length ? written.join('\n\n') + '\n' : '';
}

/**
 * One top-level block in canonical form, without a trailing line ending. `previous` and
 * `previousText` are the block before it, which decides list markers and is the context escapes
 * are checked in. `exact` is false when no form of the block parses back to it (§8.4).
 */
export function serializeBlock(block: MarkdownNode, previous: MarkdownNode | null, previousText: string | null, atFileStart: boolean): { text: string; exact: boolean } {
  const resolver = new EscapeResolver(block, previous, previousText, atFileStart);
  const text = resolver.resolve();
  return { text, exact: resolver.roundTrips(text) };
}

type AutolinkForm = 'angle' | 'bare' | 'inline';
const AUTOLINK_FORMS: AutolinkForm[] = ['angle', 'bare', 'inline'];

/** Decides which characters to escape (§8.3.1), by parsing. */
class EscapeResolver {
  constructor(private block: MarkdownNode, private previous: MarkdownNode | null, private previousText: string | null, private atFileStart: boolean) {}

  resolve(): string {
    for (const form of AUTOLINK_FORMS) {
      const text = this.attempt(form);
      if (text !== null) return text;
    }
    return this.write(() => true, 'inline').text;
  }

  /** Attempts 1 and 2 for one autolink form, or null if neither starting point round-trips. */
  private attempt(form: AutolinkForm): string | null {
    const all = this.write(() => true, form);
    if (all.unusableForm) return null;
    const punctuation = new Set<number>();
    for (let i = 0; i < all.count; i++) if (!all.whitespace.has(i)) punctuation.add(i);
    if (this.roundTrips(this.write((i) => punctuation.has(i), form).text)) return this.pass(punctuation, form);
    if (this.roundTrips(all.text)) {
      const everything = new Set(Array.from({ length: all.count }, (_, i) => i));
      return this.pass(everything, form);
    }
    return null;
  }

  /** Unescapes candidates right to left, keeping each unescaped only if the block still round-trips. */
  private pass(candidates: Set<number>, form: AutolinkForm): string {
    const escaped = new Set(candidates);
    for (const i of [...candidates].sort((a, b) => b - a)) {
      escaped.delete(i);
      if (!this.roundTrips(this.write((k) => escaped.has(k), form).text)) escaped.add(i);
    }
    return this.write((k) => escaped.has(k), form).text;
  }

  private write(escape: (i: number) => boolean, autolinks: AutolinkForm): { text: string; count: number; whitespace: Set<number>; unusableForm: boolean } {
    const writer = new BlockWriter(escape, autolinks);
    const lines = writer.block(this.block, this.previous, { atFileStart: this.atFileStart });
    return { text: lines.join('\n'), count: writer.candidateCount, whitespace: writer.whitespaceCandidates, unusableForm: writer.unusableForm };
  }

  /** Whether `text` parses back to the block, after the previous block and with its footnotes defined. */
  roundTrips(text: string): boolean {
    let doc = '';
    let offset = 0;
    if (this.previousText !== null) {
      doc += this.previousText + '\n\n';
      offset = childrenOf(parse(this.previousText + '\n')).length;
    }
    if (this.block.type === 'footnoteDefinition') {
      doc = `[^${this.block.label ?? ''}]\n\n` + doc;
      offset += 1;
    }
    doc += text + '\n';
    for (const label of footnoteLabels(this.block)) doc += `\n[^${label}]: x\n`;
    const parsed = childrenOf(parse(doc));
    return offset < parsed.length && deepEqual(parsed[offset], this.block);
  }
}

function footnoteLabels(node: MarkdownNode): string[] {
  if (node.type === 'footnoteReference') return [node.label ?? ''];
  if (node.type === 'callout') return [...(node.title ?? []), ...node.children].flatMap(footnoteLabels);
  return childrenOf(node).flatMap(footnoteLabels);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]));
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const isAsciiPunct = (c: string) => c.length === 1 && c.charCodeAt(0) < 128 && /^[\p{P}\p{S}]$/u.test(c);
const isPunctOrSymbol = (c: string) => /^[\p{P}\p{S}]$/u.test(c);
const isAlphanumeric = (c: string | undefined) => c !== undefined && /^[\p{L}\p{N}]$/u.test(c);

/** Writes blocks and inlines in canonical form, numbering escape candidates in writing order. */
export class BlockWriter {
  candidateCount = 0;
  /** Candidates escaped as character references: whitespace, and non-ASCII punctuation and symbols. */
  whitespaceCandidates = new Set<number>();
  /**
   * Set when the angle form has an http, https or ftp link whose text is its url but which
   * `<…>` can't hold (§8.3, Autolinks): that form doesn't apply, and the next writes it bare. Not
   * left to whether `[text](url)` happens to parse back, which differs between parsers (cmark-gfm
   * links the text again inside the brackets).
   */
  unusableForm = false;
  /** Right after a bare link: text is written as is up to the next whitespace (§8.3, Autolinks). */
  private afterBareLink = false;

  constructor(private escape: (i: number) => boolean, private autolinks: AutolinkForm = 'angle') {}

  // MARK: Blocks

  block(node: MarkdownNode, previous: MarkdownNode | null, ctx: { atFileStart?: boolean; afterParagraphLine?: boolean; inDashItem?: boolean } = {}): string[] {
    let lines: string[];
    switch (node.type) {
      case 'paragraph': {
        lines = this.inline(node.children).split('\n');
        if (node.blockId !== null) lines[lines.length - 1] += ` ^${node.blockId}`;
        return lines;
      }
      case 'heading': {
        const text = this.inline(node.children);
        const hashes = '#'.repeat(node.depth);
        // A heading whose text spans lines can only be written setext.
        if (text.includes('\n') && node.depth <= 2) return [...text.split('\n'), node.depth === 1 ? '===' : '---'];
        return [text === '' ? hashes : hashes + ' ' + text];
      }
      case 'thematicBreak':
        // `---` would open frontmatter, read as a list item's own break, or underline a setext heading here.
        return [ctx.atFileStart || ctx.afterParagraphLine || ctx.inDashItem ? '***' : '---'];
      case 'code': {
        const info = escapeEntitiesAndBackslashes([node.lang, node.meta].filter((x): x is string => x !== null).join(' '));
        const char = info.includes('`') ? '~' : '`';
        const fence = char.repeat(Math.max(3, longestRun(char, node.value) + 1));
        lines = [fence + info, ...(node.value === '' ? [] : node.value.split('\n')), fence];
        break;
      }
      case 'math':
        lines = ['$$', ...node.value.split('\n'), '$$'];
        break;
      case 'html':
        return node.value.split('\n');
      case 'yaml':
        return ['---', ...(node.value === '' ? [] : node.value.split('\n')), '---'];
      case 'blockquote':
        lines = node.children.length ? quote(this.blocks(node.children, false)) : ['>'];
        break;
      case 'callout': {
        let head = `[!${node.calloutType}]` + (node.fold ?? '');
        if (node.title !== null) head += ' ' + this.inline(node.title);
        const body = [head];
        const kids = node.children;
        if (kids[0]?.type === 'paragraph') {
          body.push(...this.block(kids[0], null));
          const rest = this.blocks(kids.slice(1), false);
          if (rest.length) body.push('', ...rest);
        } else if (kids.length) {
          body.push('', ...this.blocks(kids, false));
        }
        lines = quote(body);
        break;
      }
      case 'list':
        lines = this.list(node.ordered, node.start ?? 1, node.spread, node.children, previous);
        break;
      case 'table':
        lines = this.table(node.align, node.children);
        break;
      case 'footnoteDefinition': {
        const inner = this.blocks(node.children, false);
        const head = `[^${node.label ?? ''}]:`;
        if (!inner.length) return [head];
        return [head + ' ' + inner[0], ...inner.slice(1).map((l) => (l === '' ? '' : '    ' + l))];
      }
      default:
        return [this.inline([node])];
    }
    // Standalone block id (§4.6): a blank line, then `^id`.
    if ('blockId' in node && node.blockId !== null) lines.push('', `^${node.blockId}`);
    return lines;
  }

  /** Sibling blocks: a blank line between them, none in a tight list item. */
  blocks(kids: MarkdownNode[], tight: boolean, inDashItem = false): string[] {
    const out: string[] = [];
    kids.forEach((kid, i) => {
      if (i > 0 && !tight) out.push('');
      const afterParagraphLine = tight && i > 0 && kids[i - 1].type === 'paragraph';
      out.push(...this.block(kid, i > 0 ? kids[i - 1] : null, { afterParagraphLine, inDashItem: inDashItem && i === 0 }));
    });
    return out;
  }

  private list(ordered: boolean, start: number, spread: boolean, items: MarkdownNode[], previous: MarkdownNode | null): string[] {
    // Two adjacent lists of the same kind and marker would merge, so alternate.
    const alternate = previous?.type === 'list' && previous.ordered === ordered;
    const out: string[] = [];
    items.forEach((item, i) => {
      if (item.type !== 'listItem') return;
      if (i > 0 && spread) out.push('');
      const marker = ordered ? `${start + i}${alternate ? ')' : '.'}` : alternate ? '*' : '-';
      const indent = ' '.repeat(marker.length + 1);
      let inner = this.blocks(item.children, !item.spread, marker === '-' && item.checked === null);
      if (item.checked !== null) {
        // An empty task keeps the space after its box: without it, it isn't a task.
        const box = item.checked ? '[x]' : '[ ]';
        if (!inner.length || inner[0] === '') inner = [box + ' ', ...inner.slice(1)];
        else inner[0] = box + ' ' + inner[0];
      }
      if (!inner.length) { out.push(marker); return; }
      out.push(inner[0] === '' ? marker : marker + ' ' + inner[0]);
      out.push(...inner.slice(1).map((l) => (l === '' ? '' : indent + l)));
    });
    return out;
  }

  private table(align: Align[], rows: MarkdownNode[]): string[] {
    const row = (cells: string[]) => '| ' + cells.join(' | ') + ' |';
    const out: string[] = [];
    rows.forEach((r, i) => {
      out.push(row(childrenOf(r).map((cell) => this.inline(childrenOf(cell), true))));
      if (i === 0) out.push(row(align.map((a) => (a === 'left' ? ':--' : a === 'right' ? '--:' : a === 'center' ? ':-:' : '---'))));
    });
    return out;
  }

  // MARK: Inlines

  /** `delimiter` is the emphasis character of the enclosing emphasis or strong, if any. */
  inline(nodes: MarkdownNode[], inTable = false, delimiter: string | null = null): string {
    let out = '';
    nodes.forEach((node, i) => {
      // An emphasis directly inside an emphasis or strong uses `_`, unless a neighbour is a letter or digit.
      let own = '*';
      if (delimiter === '*' && node.type === 'emphasis') {
        const left = i === 0 ? undefined : Array.from(flankingText(nodes[i - 1])).pop();
        const right = i === nodes.length - 1 ? undefined : Array.from(flankingText(nodes[i + 1]))[0];
        if (!isAlphanumeric(left) && !isAlphanumeric(right)) own = '_';
      }
      out += this.inlineNode(node, inTable, own, nodes[i + 1] ?? null);
    });
    return out;
  }

  private inlineNode(node: MarkdownNode, inTable: boolean, d: string, next: MarkdownNode | null): string {
    if (node.type !== 'text') this.afterBareLink = false;
    switch (node.type) {
      case 'text': return this.text(node.value);
      case 'emphasis': return d + this.inline(node.children, inTable, d) + d;
      case 'strong': return d + d + this.inline(node.children, inTable, d) + d + d;
      case 'delete': return '~~' + this.inline(node.children, inTable) + '~~';
      case 'highlight': return '==' + this.inline(node.children, inTable) + '==';
      case 'inlineCode': {
        const value = inTable ? node.value.replaceAll('|', '\\|') : node.value;
        const ticks = '`'.repeat(longestRun('`', value) + 1);
        const allSpaces = value !== '' && /^ +$/.test(value);
        const pad = !allSpaces && (value.startsWith(' ') || value.startsWith('`') || value.endsWith(' ') || value.endsWith('`'));
        return ticks + (pad ? ' ' : '') + value + (pad ? ' ' : '') + ticks;
      }
      case 'break': return '\\\n';
      case 'link': {
        const kids = node.children;
        if (node.title === null && kids.length === 1 && kids[0].type === 'text' && this.autolinks !== 'inline') {
          const t = kids[0].value, url = node.url;
          const scheme = ['http://', 'https://', 'ftp://'].some((s) => url.toLowerCase().startsWith(s));
          if (this.autolinks === 'bare' && t === url && scheme) { this.afterBareLink = true; return t; }
          if (t === url && isAutolinkable(url)) return '<' + url + '>';
          if (this.autolinks === 'angle' && t === url && scheme) this.unusableForm = true;
          if ('mailto:' + t === url && isAutolinkable(t)) return '<' + t + '>';
          if ('http://' + t === url && t.startsWith('www.')) { this.afterBareLink = true; return t; }
        }
        return '[' + this.inline(kids, inTable) + '](' + destination(node.url) + titlePart(node.title) + ')';
      }
      case 'image': return '![' + this.text(node.alt) + '](' + destination(node.url) + titlePart(node.title) + ')';
      case 'footnoteReference': return '[^' + (node.label ?? '') + ']';
      case 'wikiLink': return wiki(node, inTable);
      case 'embed': return '!' + wiki(node, inTable);
      case 'tag': return '#' + node.name;
      case 'inlineMath': {
        // `$x$` or `$$x$$`, whichever the parser's own scan reads back as exactly `x`, given what follows.
        const after = next?.type === 'text' ? Array.from(next.value)[0] : undefined;
        for (const form of ['$' + node.value + '$', '$$' + node.value + '$$']) {
          const chars = [...Array.from(form), ...(after !== undefined ? [after] : [])];
          const found = inlineMathAt(chars, 0);
          if (found && found.end === Array.from(form).length && found.value === node.value) return form;
        }
        return '$' + node.value + '$';
      }
      case 'html': return node.value;
      default: return this.inline(childrenOf(node), inTable);
    }
  }

  /** Text, with escape candidates numbered and escaped as decided. */
  private text(value: string): string {
    let out = '';
    for (const c of value) {
      if (this.afterBareLink) {
        // Up to and including the next whitespace, as is: in raw source neither `\` nor `&#32;` ends the link.
        out += c;
        if (/^\s$/u.test(c)) this.afterBareLink = false;
        continue;
      }
      if (isAsciiPunct(c)) {
        if (this.escape(this.candidateCount)) out += '\\';
        this.candidateCount++;
        out += c;
      } else if (c === ' ' || c === '\t' || c === '\n' || (c.codePointAt(0)! >= 128 && isPunctOrSymbol(c))) {
        const escaped = this.escape(this.candidateCount);
        this.whitespaceCandidates.add(this.candidateCount);
        this.candidateCount++;
        out += escaped ? `&#${c.codePointAt(0)};` : c;
      } else {
        out += c;
      }
    }
    return out;
  }
}

const quote = (lines: string[]) => lines.map((l) => (l === '' ? '>' : '> ' + l));

function wiki(r: WikiLinkReference, inTable: boolean): string {
  let s = '[[' + r.target;
  if (r.heading !== null) s += '#' + r.heading;
  if (r.blockId !== null) s += '#^' + r.blockId;
  if (r.alias !== null) s += (inTable ? '\\|' : '|') + r.alias;
  return s + ']]';
}

const isAutolinkable = (s: string) => s !== '' && !/[\s<>&\\]/u.test(s);

/** A link destination: `\` and entity-starting `&` escaped; `<…>` for spaces, parentheses and angle brackets. */
function destination(url: string): string {
  const escaped = escapeEntitiesAndBackslashes(url);
  if (url === '' || /[ ()<>]/.test(url)) return '<' + escaped.replaceAll('<', '\\<').replaceAll('>', '\\>') + '>';
  return escaped;
}

function titlePart(title: string | null): string {
  return title === null ? '' : ' "' + escapeEntitiesAndBackslashes(title).replaceAll('"', '\\"') + '"';
}

/** For strings CommonMark processes for entities and escapes: `\` doubled, entity `&` escaped, line endings as references. */
export function escapeEntitiesAndBackslashes(s: string): string {
  return s.replaceAll('\\', '\\\\').replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&').replaceAll('\r', '&#13;').replaceAll('\n', '&#10;');
}
