import { checkboxOffset } from './convert';
import { internalPageReference } from './extract';
import { anatomy, parse, parseLayout } from './parse';
import { splitLines } from './preprocess';
import type { LinkResolver } from './resolve';
import { deepEqual, serializeBlock } from './serialize';
import { childrenOf as kidsOf, withChildren as replaceKids, type MarkdownNode, type WikiLinkReference as Ref } from './tree';

/** A link found in a page, as `rewriteLinks` is asked about it. */
export interface LinkOccurrence {
  kind: 'wiki' | 'embed' | 'markdown';
  /** For a markdown link: the decoded path without `.md`, with its fragment as heading or block id (§6). */
  reference: Ref;
}

/**
 * What an in-place edit did. `inPlace`: only the edited construct's text changed; otherwise the
 * affected blocks were written canonically. `exact`: the page's text parses to its tree (§8.4).
 */
export interface EditResult { inPlace: boolean; exact: boolean }

/**
 * A page as an editor holds it: its tree, plus the exact text it was parsed from, split into
 * top-level blocks and the gaps between them (SPEC §8.1). Saving writes every unchanged block and
 * gap back exactly, so a page saved without edits is identical to its file; a replaced or
 * inserted block is written canonically (§8.3) with the file's line endings. A port of
 * AtlasKit's `MarkdownDocument`.
 */
export class MarkdownDocument {
  /** The top-level blocks, frontmatter first when present. */
  blocks: MarkdownNode[];
  /** `gaps[i]` comes before `blocks[i]`; the last gap follows the last block. */
  /** @internal */ gaps: string[];
  /** @internal */ blockText: string[];
  /** The line ending new text uses: the file's first, or `\n`. */
  readonly lineEnding: string;

  constructor(source: string) {
    const layout = parseLayout(source);
    const lines = splitLines(source);
    this.lineEnding = lines.find((l) => l.ending !== '')?.ending ?? '\n';
    const gaps: string[] = [], texts: string[] = [];
    let line = 1, gap = '';
    const take = (i: number) => lines[i - 1];
    // Ranges in order, never overlapping, and inside the file, so every line is written once.
    let floor = 1;
    const last = Math.max(lines.length, 1);
    const ranges = layout.map((b) => {
      const lower = Math.min(Math.max(b.lines[0], floor), last);
      const upper = Math.min(Math.max(b.lines[1], lower), last);
      floor = upper + 1;
      return [lower, upper] as const;
    });
    for (const [lower, upper] of ranges) {
      if (lower < line || lower > lines.length) { gaps.push(gap); gap = ''; texts.push(''); continue; }
      while (line < lower) { gap += take(line).content + take(line).ending; line++; }
      gaps.push(gap);
      let text = '';
      for (let l = lower; l <= upper; l++) {
        text += take(l).content;
        if (l < upper) text += take(l).ending; else gap = take(l).ending;
      }
      texts.push(text);
      line = upper + 1;
    }
    if (!layout.length) gap = '';
    while (line <= lines.length) { gap += take(line).content + take(line).ending; line++; }
    gaps.push(gap);
    // A BOM belongs to the gap before the first block, so replacing that block keeps it.
    if (texts.length && texts[0].startsWith('﻿') && gaps[0] === '') {
      texts[0] = texts[0].slice(1);
      gaps[0] = '﻿';
    }
    this.blocks = layout.map((b) => b.node);
    this.gaps = gaps;
    this.blockText = texts;
  }

  get tree(): MarkdownNode { return { type: 'root', children: this.blocks }; }

  /** The page's text: unchanged blocks and gaps as they were, edits in canonical form. */
  serialized(): string {
    let out = this.gaps[0];
    this.blocks.forEach((_, i) => { out += this.blockText[i] + this.gaps[i + 1]; });
    return out;
  }

  /** Whether the page's text parses to its tree. */
  get isExact(): boolean { return deepEqual(parse(this.serialized()), this.tree); }

  /** Replaces a top-level block; returns whether the page still parses to its tree (§8.4). */
  replaceBlock(index: number, node: MarkdownNode): boolean {
    this.blocks[index] = node;
    this.blockText[index] = this.canonicalText(index);
    this.ensureBlankLines(index);
    return this.isExact;
  }

  /** Inserts a top-level block, one blank line from its neighbours. */
  insertBlock(node: MarkdownNode, index: number): boolean {
    const blank = this.lineEnding + this.lineEnding;
    this.blocks.splice(index, 0, node);
    this.blockText.splice(index, 0, '');
    if (this.blocks.length === 1) this.gaps = [this.gaps[0], this.lineEnding];
    else if (index === this.blocks.length - 1) this.gaps.splice(index, 0, blank);
    else this.gaps.splice(index + 1, 0, blank);
    this.blockText[index] = this.canonicalText(index);
    // The new block can change how the next one reads (a list after a list merges): rewrite it.
    if (!this.isExact && index + 1 < this.blocks.length) this.blockText[index + 1] = this.canonicalText(index + 1);
    return this.isExact;
  }

  /** Removes a top-level block, with the gap after it (or before it, at the end). */
  removeBlock(index: number): boolean {
    this.blocks.splice(index, 1);
    this.blockText.splice(index, 1);
    if (index < this.blocks.length || index === 0) this.gaps.splice(index + 1, 1); else this.gaps.splice(index, 1);
    if (!this.isExact && index < this.blocks.length && index > 0) {
      this.blockText[index] = this.canonicalText(index);
      this.ensureBlankLines(index);
    }
    return this.isExact;
  }

  private canonicalText(index: number): string {
    const previous = index > 0 ? this.blocks[index - 1] : null;
    const previousText = index > 0 ? this.blockText[index - 1].replace(/\r\n?/g, '\n') : null;
    const atFileStart = index === 0 && /^﻿*$/.test(this.gaps[0]);
    const { text } = serializeBlock(this.blocks[index], previous, previousText, atFileStart);
    return this.lineEnding === '\n' ? text : text.replaceAll('\n', this.lineEnding);
  }

  /** A changed block needs a blank line each side; a gap without one gets one. */
  private ensureBlankLines(index: number): void {
    const blank = this.lineEnding + this.lineEnding;
    if (index > 0 && splitLines(this.gaps[index]).length < 2) this.gaps[index] = blank;
    if (index < this.blocks.length - 1 && splitLines(this.gaps[index + 1]).length < 2) this.gaps[index + 1] = blank;
  }

  // MARK: In-place edits (§8.2): the two Atlas makes on the user's behalf. Each is made on the
  // text and checked by parsing the page; if anything else would read differently, it's undone
  // and the block is written canonically instead, and the result says so.

  /** The number of task items in the page, in tree order. */
  get taskCount(): number { return this.blocks.reduce((n, b) => n + taskCount(b), 0); }

  /** Ticks or unticks the task at `index` (tree order): only the character between its brackets changes. */
  setTask(index: number, checked: boolean): EditResult {
    let local = index;
    for (let k = 0; k < this.blocks.length; k++) {
      const count = taskCount(this.blocks[k]);
      if (local >= count) { local -= count; continue; }
      const expected = settingTask(this.blocks[k], local, checked, { n: 0 });
      const a = anatomy(this.blockText[k]);
      if (a.tasks.length === count) {
        const text = togglingCheckbox(this.blockText[k], a.tasks[local], checked);
        if (text !== null && commitIfOnlyChanged(this, k, expected, text)) return { inPlace: true, exact: true };
      }
      return { inPlace: false, exact: this.replaceBlock(k, expected) };
    }
    throw new RangeError(`task ${index} out of range (${this.taskCount} tasks)`);
  }

  /**
   * Rewrites link targets: `newTarget` is asked about every wiki link, embed and internal
   * markdown link, and returns the new target or null. Only the targets' text changes; reference
   * definitions in the gaps are rewritten too.
   */
  rewriteLinks(newTarget: (o: LinkOccurrence) => string | null): EditResult & { rewritten: number } {
    let rewritten = 0;
    const expected = this.blocks.map((b) => rewritingLinks(b, newTarget));
    for (const b of this.blocks) rewritingLinks(b, (o) => { const t = newTarget(o); if (t !== null) rewritten++; return t; });
    if (deepEqual(expected, this.blocks)) return { rewritten: 0, inPlace: true, exact: true };
    const before = kidsOf(parse(this.serialized()));
    const saved = { blocks: [...this.blocks], text: [...this.blockText], gaps: [...this.gaps] };
    let inPlace = true;
    for (let k = 0; k < this.blocks.length; k++) {
      if (deepEqual(expected[k], this.blocks[k])) continue;
      const text = rewritingLinkBytes(this.blockText[k], this.blocks[k], newTarget);
      if (text === null) { inPlace = false; break; }
      this.blockText[k] = text;
      this.blocks[k] = expected[k];
    }
    if (inPlace) {
      this.gaps = this.gaps.map((g) => rewritingDefinitions(g, newTarget));
      inPlace = deepEqual(kidsOf(parse(this.serialized())), before.map((b) => rewritingLinks(b, newTarget)));
    }
    if (!inPlace) {
      this.blocks = saved.blocks; this.blockText = saved.text; this.gaps = saved.gaps;
      for (let k = 0; k < this.blocks.length; k++) if (!deepEqual(expected[k], this.blocks[k])) this.replaceBlock(k, expected[k]);
    }
    return { rewritten, inPlace, exact: inPlace || this.isExact };
  }

  /**
   * Rewrites the links in this page (`linkingPage`) that resolved to `oldPath` before a rename or
   * move, to the shortest target reaching `newPath` after it (§7). Same-page links are never touched.
   */
  rewriteLinksToRenamed(oldPath: string, newPath: string, linkingPage: string, before: LinkResolver, after: LinkResolver): EditResult & { rewritten: number } {
    const target = after.linkTarget(newPath);
    return this.rewriteLinks((o) => (o.reference.target !== '' && before.resolve(o.reference.target, linkingPage) === oldPath ? target : null));
  }
}


/** A link found in a page, as `rewriteLinks` is asked about it. */
export interface LinkOccurrence {
  kind: 'wiki' | 'embed' | 'markdown';
  /** For a markdown link: the decoded path without `.md`, with its fragment as heading or block id (§6). */
  reference: Ref;
}

/**
 * What an in-place edit did. `inPlace`: only the edited construct's text changed; otherwise the
 * affected blocks were written canonically. `exact`: the page's text parses to its tree (§8.4).
 */
export interface EditResult { inPlace: boolean; exact: boolean }

/** Applies `text` to block `k` if the page then parses as before, except that block `k` is `expected`. */
function commitIfOnlyChanged(doc: MarkdownDocument, k: number, expected: MarkdownNode, text: string): boolean {
  const wanted = kidsOf(parse(doc.serialized()));
  if (k >= wanted.length) return false;
  wanted[k] = expected;
  const saved = [doc.blocks[k], doc.blockText[k]] as const;
  doc.blocks[k] = expected;
  doc.blockText[k] = text;
  if (deepEqual(kidsOf(parse(doc.serialized())), wanted)) return true;
  [doc.blocks[k], doc.blockText[k]] = saved;
  return false;
}

function taskCount(node: MarkdownNode): number {
  return (node.type === 'listItem' && node.checked !== null ? 1 : 0) + kidsOf(node).reduce((n, c) => n + taskCount(c), 0);
}

function settingTask(node: MarkdownNode, index: number, checked: boolean, counter: { n: number }): MarkdownNode {
  let out = node;
  if (node.type === 'listItem' && node.checked !== null) {
    if (counter.n === index) out = { ...node, checked };
    counter.n++;
  }
  const kids = kidsOf(out);
  return kids.length ? replaceKids(out, kids.map((c) => settingTask(c, index, checked, counter))) : out;
}

/** The text with one checkbox's character set; the item's marker is at `position`. */
export function togglingCheckbox(text: string, position: { line: number; column: number }, checked: boolean): string | null {
  const lines = splitLines(text);
  if (position.line < 1 || position.line > lines.length) return null;
  const content = lines[position.line - 1].content;
  const at = checkboxOffset(content, position.column);
  if (at === null) return null;
  if ((content[at] !== ' ') === checked) return text;
  lines[position.line - 1].content = content.slice(0, at) + (checked ? 'x' : ' ') + content.slice(at + 1);
  return lines.map((l) => l.content + l.ending).join('');
}

function rewritingLinks(node: MarkdownNode, newTarget: (o: LinkOccurrence) => string | null): MarkdownNode {
  const ref = (n: Ref): Ref => ({ target: n.target, heading: n.heading, blockId: n.blockId, alias: n.alias });
  switch (node.type) {
    case 'wikiLink': case 'embed': {
      const t = newTarget({ kind: node.type === 'wikiLink' ? 'wiki' : 'embed', reference: ref(node) });
      return t === null ? node : { ...node, target: t };
    }
    case 'link': {
      let url = node.url;
      const r = internalPageReference(url);
      const t = r ? newTarget({ kind: 'markdown', reference: r }) : null;
      if (t !== null) url = rewrittenURL(url, t);
      return { ...node, url, children: node.children.map((c) => rewritingLinks(c, newTarget)) };
    }
    case 'callout':
      return { ...node, title: node.title?.map((c) => rewritingLinks(c, newTarget)) ?? null, children: node.children.map((c) => rewritingLinks(c, newTarget)) };
    default: {
      const kids = kidsOf(node);
      return kids.length ? replaceKids(node, kids.map((c) => rewritingLinks(c, newTarget))) : node;
    }
  }
}

/** A markdown link url pointing at `target` instead, keeping its fragment, and percent-encoding if the old path used it. */
export function rewrittenURL(url: string, target: string): string {
  const hash = url.indexOf('#');
  const path = hash >= 0 ? url.slice(0, hash) : url;
  const fragment = hash >= 0 ? url.slice(hash) : '';
  let newPath = target + '.md';
  if (path.includes('%')) newPath = encodeURI(newPath).replace(/[?#]/g, encodeURIComponent);
  return newPath + fragment;
}

/** The block's text with only rewritten links' targets changed, or null if its links can't be matched to the tree. */
function rewritingLinkBytes(text: string, node: MarkdownNode, newTarget: (o: LinkOccurrence) => string | null): string | null {
  const edits: { start: number; end: number; replacement: string }[] = [];
  const a = anatomy(text);
  const wiki: { kind: 'wiki' | 'embed'; ref: Ref }[] = [];
  collectWiki(node, wiki);
  if (wiki.length !== a.links.length) return null;
  for (let i = 0; i < wiki.length; i++) {
    const t = newTarget({ kind: wiki[i].kind, reference: wiki[i].ref });
    if (t === null) continue;
    const [start, end] = a.links[i];
    const raw = rewritingWikiTarget(text.slice(start, end), t);
    if (raw === null) return null;
    edits.push({ start, end, replacement: raw });
  }
  // Inline markdown links: destinations in the text, matched to the tree's links in order by url.
  const destinations = inlineDestinations(text, a.opaque);
  const targets: { url: string; isImage: boolean }[] = [];
  collectLinkURLs(node, targets);
  let cursor = 0;
  for (const { url, isImage } of targets) {
    const found = destinations.findIndex((d, i) => i >= cursor && d.url === url && d.isImage === isImage);
    if (found < 0) continue;
    cursor = found + 1;
    if (isImage) continue;
    const r = internalPageReference(url);
    const t = r ? newTarget({ kind: 'markdown', reference: r }) : null;
    if (t === null) continue;
    const d = destinations[found];
    edits.push({ start: d.start, end: d.end, replacement: writtenDestination(rewrittenURL(url, t), d.angle) });
  }
  let out = text;
  for (const e of edits.sort((x, y) => y.start - x.start)) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  // The parser lifts reference definitions off a paragraph's start, so one can sit in a block's text.
  return rewritingDefinitions(out, newTarget, true);
}

function collectWiki(node: MarkdownNode, out: { kind: 'wiki' | 'embed'; ref: Ref }[]): void {
  if (node.type === 'wikiLink' || node.type === 'embed') {
    out.push({ kind: node.type === 'wikiLink' ? 'wiki' : 'embed', ref: { target: node.target, heading: node.heading, blockId: node.blockId, alias: node.alias } });
    return;
  }
  if (node.type === 'callout') (node.title ?? []).forEach((c) => collectWiki(c, out));
  kidsOf(node).forEach((c) => collectWiki(c, out));
}

function collectLinkURLs(node: MarkdownNode, out: { url: string; isImage: boolean }[]): void {
  if (node.type === 'link') out.push({ url: node.url, isImage: false });
  if (node.type === 'image') out.push({ url: node.url, isImage: true });
  if (node.type === 'callout') (node.title ?? []).forEach((c) => collectLinkURLs(c, out));
  kidsOf(node).forEach((c) => collectLinkURLs(c, out));
}

/** `[[target#…|…]]` with only the target replaced; the whitespace around it and all after it stay. */
export function rewritingWikiTarget(raw: string, target: string): string | null {
  const prefix = raw.startsWith('![[') ? '![[' : '[[';
  if (!raw.startsWith(prefix) || !raw.endsWith(']]')) return null;
  const inner = raw.slice(prefix.length, -2);
  let end = inner.length;
  const stop = inner.search(/[#|]/);
  if (stop >= 0) {
    end = stop;
    if (inner[stop] === '|' && stop > 0 && inner[stop - 1] === '\\') end = stop - 1;
  }
  const segment = inner.slice(0, end);
  const leading = /^[ \t]*/.exec(segment)![0];
  const trailing = /[ \t]*$/.exec(segment)![0];
  return prefix + leading + target + trailing + inner.slice(end) + ']]';
}

const DESTINATION = /\]\([ \t]*(<(?:[^<>\n\\]|\\.)*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))+)(?=[ \t]*\n?[ \t]*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\))?[ \t]*\))/y;

/** Inline link destinations in order: their range (with angle brackets), url as read, and kind. */
export function inlineDestinations(text: string, opaque: [number, number][] = []): { start: number; end: number; url: string; angle: boolean; isImage: boolean }[] {
  const out: { start: number; end: number; url: string; angle: boolean; isImage: boolean }[] = [];
  for (let from = text.indexOf(']('); from >= 0; from = text.indexOf('](', from + 1)) {
    if (opaque.some(([s, e]) => from >= s && from < e)) continue;
    const opener = openingBracket(text, from);
    if (opener === null) continue;
    DESTINATION.lastIndex = from;
    const m = DESTINATION.exec(text);
    if (!m) continue;
    const start = from + m[0].indexOf(m[1], 2);
    let raw = m[1];
    const angle = raw.startsWith('<');
    if (angle) raw = raw.slice(1, -1);
    out.push({ start, end: start + m[1].length, url: unescapingBackslashes(raw), angle, isImage: opener > 0 && text[opener - 1] === '!' });
  }
  return out;
}

/** The unescaped `[` the `]` at `close` balances, or null. */
function openingBracket(text: string, close: number): number | null {
  let depth = 1;
  for (let i = close - 1; i >= 0; i--) {
    let backslashes = 0;
    while (i - backslashes - 1 >= 0 && text[i - backslashes - 1] === '\\') backslashes++;
    if (backslashes % 2 !== 0) continue;
    if (text[i] === ']') depth++;
    else if (text[i] === '[') { depth--; if (depth === 0) return i; }
  }
  return null;
}

function writtenDestination(url: string, angle: boolean): string {
  const escaped = url.replaceAll('\\', '\\\\');
  if (angle || /[ ()<>]/.test(url)) return '<' + escaped.replaceAll('<', '\\<').replaceAll('>', '\\>') + '>';
  return escaped;
}

function unescapingBackslashes(s: string): string {
  let out = '', escaped = false;
  for (const c of s) {
    if (escaped) { if (!(c.charCodeAt(0) < 128 && /^[\p{P}\p{S}]$/u.test(c))) out += '\\'; out += c; escaped = false; }
    else if (c === '\\') escaped = true;
    else out += c;
  }
  return escaped ? out + '\\' : out;
}

const DEFINITION = /^((?: {0,3}>[ ]?)*[ ]{0,3})\[((?:[^[\]\\\n]|\\.)+)\]:[ \t]*(<[^<>\n]*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))+)[ \t]*(?:(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\((?:[^()\\\n]|\\.)*\))[ \t]*)?$/gm;

/** Text with internal reference definitions' destinations rewritten; in a block (`leadingOnly`) only its leading lines count. */
export function rewritingDefinitions(gap: string, newTarget: (o: LinkOccurrence) => string | null, leadingOnly = false): string {
  let matches = [...gap.matchAll(DEFINITION)];
  if (leadingOnly) {
    const kept: typeof matches = [];
    let expected = 0;
    for (const m of matches) {
      if (m.index !== expected) continue;
      kept.push(m);
      expected = m.index! + m[0].length;
      while (gap[expected] === '\r' || gap[expected] === '\n') expected++;
    }
    matches = kept;
  }
  let out = gap;
  for (const m of matches.reverse()) {
    const start = m.index! + m[0].indexOf(']:') + 2 + /^[ \t]*/.exec(m[0].slice(m[0].indexOf(']:') + 2))![0].length;
    let raw = m[3];
    const angle = raw.startsWith('<');
    if (angle) raw = raw.slice(1, -1);
    const url = unescapingBackslashes(raw);
    const r = internalPageReference(url);
    const t = r ? newTarget({ kind: 'markdown', reference: r }) : null;
    if (t === null) continue;
    out = out.slice(0, start) + writtenDestination(rewrittenURL(url, t), angle) + out.slice(start + m[3].length);
  }
  return out;
}
