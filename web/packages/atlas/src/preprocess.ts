import type { WikiLinkReference } from './tree';

/**
 * Prepares Atlas Markdown source for the GFM parser. Everything that depends on the *raw*
 * source text is decided here, before the parser processes escapes and inline syntax. A port of
 * AtlasKit's `SourcePreprocessor`, so both implementations make the same decisions:
 *
 * - **Frontmatter** (§4.1) is lifted out; its lines are blanked, keeping line numbers.
 * - **Math blocks** (§4.8) become tilde-fenced code blocks with a sentinel info string, so the
 *   parser keeps their content verbatim. The line count doesn't change.
 * - **Escaped trigger characters** (`\#`, `\=`, `\^`, `\[`, `\$`) become reserved marker
 *   characters, so later passes see they were escaped.
 * - **Wiki links, embeds and inline math** (§4.2, §4.3, §4.8) become opaque placeholder tokens:
 *   their content is raw by spec, and the parser must not read emphasis or links inside them.
 */

export type Token =
  | { kind: 'wikiLink'; ref: WikiLinkReference; raw: string }
  | { kind: 'embed'; ref: WikiLinkReference; raw: string }
  | { kind: 'inlineMath'; value: string; raw: string }
  /** A reserved character the source already contained, protected so it can't pass for a marker. */
  | { kind: 'literal'; raw: string }
  /** A numeric character reference that decodes into the reserved ranges. */
  | { kind: 'reference'; decoded: string; raw: string };

// Escape markers and the two ends of every placeholder are Unicode punctuation (U+2E3C–U+2E42),
// as the characters they stand for are: emphasis flanking depends on it. Placeholder digits are
// private-use characters, which never touch a delimiter.
export const TOKEN_START = '⸼';
export const TOKEN_END = '⸽';
const DIGIT_BASE = 0xe020;
export const MATH_INFO = 'atlas-math';

const ESCAPE_MARKERS: Record<string, string> = { '#': '⸾', '=': '⸿', '^': '⹀', '[': '⹁', $: '⹂' };
export const ESCAPED_CHARACTER: Record<string, string> = Object.fromEntries(Object.entries(ESCAPE_MARKERS).map(([c, m]) => [m, c]));

export function isReserved(cp: number): boolean {
  return (cp >= 0xe000 && cp <= 0xe0ff) || (cp >= 0x2e3c && cp <= 0x2e42);
}
const hasReserved = (s: string) => { for (const c of s) if (isReserved(c.codePointAt(0)!)) return true; return false; };

export function placeholder(index: number): string {
  let s = TOKEN_START;
  for (const d of String(index)) s += String.fromCodePoint(DIGIT_BASE + Number(d));
  return s + TOKEN_END;
}

/**
 * Reads a placeholder's digits and end, from code-point index `i` of `cps` (just after its
 * start). Returns the token index (or null when malformed: then it's plain text) and the index
 * after what was read. Never throws, whatever the input.
 */
export function readToken(cps: string[], i: number, count: number): { index: number | null; next: number } {
  let index = 0, digits = 0, j = i;
  while (j < cps.length) {
    const d = cps[j].codePointAt(0)!;
    j++;
    if (cps[j - 1] === TOKEN_END) return { index: digits > 0 && index < count ? index : null, next: j };
    if (d < DIGIT_BASE || d > DIGIT_BASE + 9 || digits >= 9) return { index: null, next: j };
    index = index * 10 + (d - DIGIT_BASE);
    digits++;
  }
  return { index: null, next: j };
}

export interface Line { content: string; ending: string }

/** Lines with their endings (`\n`, `\r\n`, `\r`, or none for a last line without one). */
export function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || c === 13) {
      let end = i + 1;
      if (c === 13 && text.charCodeAt(end) === 10) end++;
      lines.push({ content: text.slice(start, i), ending: text.slice(i, end) });
      start = end;
      i = end - 1;
    }
  }
  if (start < text.length) lines.push({ content: text.slice(start), ending: '' });
  return lines;
}

const ws = /^\s$/u;
const isWhitespace = (c: string | undefined) => c !== undefined && ws.test(c);
const isNewline = (c: string | undefined) => c !== undefined && /^[\n\r\v\f\u0085\u2028\u2029]$/.test(c);
const isAsciiDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
const isAsciiPunctOrSymbol = (c: string) => c.length === 1 && c.charCodeAt(0) < 128 && /^[\p{P}\p{S}]$/u.test(c);

export class Preprocessed {
  /** The text handed to the parser. */
  parserSource = '';
  /** The frontmatter value (§4.1), if the page has frontmatter. */
  frontmatter: string | null = null;
  /** How many lines the frontmatter takes, both `---` lines included. */
  frontmatterLineCount = 0;
  tokens: Token[] = [];
  /**
   * Where each wiki link, embed and inline math token came from, as UTF-16 offsets into the
   * source without its BOM. In-place link rewrites (§8.2) use these.
   */
  tokenSourceRanges = new Map<number, [number, number]>();
  /** The code spans inline protection skipped, as UTF-16 offsets like `tokenSourceRanges`. */
  codeSpanRanges: [number, number][] = [];
  private literalIndex = new Map<string, number>();

  constructor(source: string) {
    let text = source;
    if (text.startsWith('﻿')) text = text.slice(1);
    const lines = splitLines(text);
    this.frontmatter = this.liftFrontmatter(lines);
    // Inline protection runs before math fencing, so the fence's sentinel info string, in the
    // reserved range, isn't itself protected as a literal.
    const protectedLines = splitLines(this.protectInlines(lines.map((l) => l.content + l.ending).join('')));
    fenceMathBlocks(protectedLines);
    this.parserSource = protectedLines.map((l) => l.content + l.ending).join('');
  }

  /** §4.1: `---` as the very first line, closed by `---` or `...`. */
  private liftFrontmatter(lines: Line[]): string | null {
    const is = (l: Line, marks: string[]) => marks.includes(l.content.replace(/[ \t]+$/, ''));
    if (!lines.length || !is(lines[0], ['---'])) return null;
    const close = lines.findIndex((l, i) => i > 0 && is(l, ['---', '...']));
    if (close < 0) return null;
    const value = lines.slice(1, close).map((l) => l.content).join('\n');
    for (let i = 0; i <= close; i++) lines[i].content = '';
    this.frontmatterLineCount = close + 1;
    return value;
  }

  private literal(text: string): string {
    const known = this.literalIndex.get(text);
    if (known !== undefined) return placeholder(known);
    this.tokens.push({ kind: 'literal', raw: text });
    this.literalIndex.set(text, this.tokens.length - 1);
    return placeholder(this.tokens.length - 1);
  }

  private protectReserved(chars: string[], i: number): string {
    const c = chars[i];
    return hasReserved(c) || isHiddenCaret(chars, i) ? this.literal(c) : c;
  }

  /**
   * One left-to-right pass. Code spans and HTML/autolink tags are copied untouched, escapes
   * become markers, and wiki links, embeds and inline math become tokens.
   */
  private protectInlines(text: string): string {
    const chars = Array.from(text);
    // UTF-16 offset of each code point, for source ranges.
    const at: number[] = new Array(chars.length + 1);
    at[0] = 0;
    for (let k = 0; k < chars.length; k++) at[k + 1] = at[k] + chars[k].length;
    let out = '';
    let i = 0;
    while (i < chars.length) {
      const c = chars[i];
      if (!'`<\\$![^&'.includes(c) && !hasReserved(c)) { out += c; i++; continue; }

      if (hasReserved(c) || isHiddenCaret(chars, i)) { out += this.protectReserved(chars, i); i++; continue; }
      if (c === '`') {
        let run = 0;
        while (chars[i + run] === '`') run++;
        const end = codeSpanEnd(chars, i) ?? i + run;
        if (end > i + run) this.codeSpanRanges.push([at[i], at[end]]);
        for (let k = i; k < end; k++) out += this.protectReserved(chars, k);
        i = end; continue;
      }
      if (c === '<') {
        const end = tagEnd(chars, i);
        if (end !== null) {
          for (let k = i; k < end; k++) out += this.protectReserved(chars, k);
          i = end; continue;
        }
      }
      if (c === '\\' && i + 1 < chars.length) {
        const next = chars[i + 1];
        if (ESCAPE_MARKERS[next]) { out += ESCAPE_MARKERS[next]; i += 2; continue; }
        if (isAsciiPunctOrSymbol(next)) { out += c + next; i += 2; continue; }
      }
      if (c === '&') {
        const ref = reservedReference(chars, i);
        if (ref) {
          this.tokens.push({ kind: 'reference', decoded: ref.decoded, raw: chars.slice(i, ref.end).join('') });
          out += placeholder(this.tokens.length - 1);
          i = ref.end; continue;
        }
      }
      if (c === '$') {
        const math = inlineMath(chars, i);
        if (math) {
          this.tokenSourceRanges.set(this.tokens.length, [at[i], at[math.end]]);
          out += placeholder(this.tokens.length); this.tokens.push(math.token); i = math.end; continue;
        }
      }
      if (c === '!' || c === '[') {
        const link = wikiLink(chars, i);
        if (link) {
          this.tokenSourceRanges.set(this.tokens.length, [at[i], at[link.end]]);
          out += placeholder(this.tokens.length); this.tokens.push(link.token); i = link.end; continue;
        }
      }
      out += c;
      i++;
    }
    return out;
  }
}

/** §4.8: a line that is exactly `$$` opens a math block, top level only, outside code fences. */
function fenceMathBlocks(lines: Line[]): void {
  const isMathFence = (s: string) => /^ {0,3}\$\$[ \t]*$/.test(s);
  let open: { char: string; count: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const content = lines[i].content;
    if (open) {
      const close = codeFence(content);
      if (close && close.char === open.char && close.count >= open.count && close.info.trim() === '') open = null;
      continue;
    }
    const fence = codeFence(content);
    if (fence) { open = { char: fence.char, count: fence.count }; continue; }
    if (isMathFence(content)) {
      let close = -1;
      for (let j = i + 1; j < lines.length; j++) if (isMathFence(lines[j].content)) { close = j; break; }
      if (close < 0) continue;
      const longest = Math.max(0, ...lines.slice(i + 1, close).map((l) => longestRun('~', l.content)));
      const tildes = '~'.repeat(Math.max(3, longest + 1));
      lines[i].content = tildes + MATH_INFO;
      lines[close].content = tildes;
      i = close;
    }
  }
}

export function codeFence(line: string): { char: string; count: number; info: string } | null {
  const trimmed = line.replace(/^ */, '');
  if (line.length - trimmed.length > 3) return null;
  const c = trimmed[0];
  if (c !== '`' && c !== '~') return null;
  let count = 0;
  while (trimmed[count] === c) count++;
  if (count < 3) return null;
  const info = trimmed.slice(count);
  if (c === '`' && info.includes('`')) return null;
  return { char: c, count, info };
}

export function longestRun(c: string, s: string): number {
  let best = 0, run = 0;
  for (const ch of s) { run = ch === c ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}

/** A numeric character reference (`&#NNN;`, `&#xHHH;`) decoding into the reserved ranges. */
function reservedReference(chars: string[], i: number): { end: number; decoded: string } | null {
  if (i + 3 >= chars.length || chars[i + 1] !== '#') return null;
  let j = i + 2;
  const hex = chars[j] === 'x' || chars[j] === 'X';
  if (hex) j++;
  const start = j;
  while (j < chars.length && j - start < 7 && (hex ? /^[0-9a-fA-F]$/.test(chars[j]) : isAsciiDigit(chars[j]))) j++;
  if (j === start || chars[j] !== ';') return null;
  const value = parseInt(chars.slice(start, j).join(''), hex ? 16 : 10);
  if (!Number.isFinite(value) || value > 0x10ffff || !isReserved(value)) return null;
  return { end: j + 1, decoded: String.fromCodePoint(value) };
}

/** SPEC §3.2: a footnote label is one or more letters, digits, `-` or `_`, then `]`. */
function isFootnoteLabel(chars: string[], from: number): boolean {
  let j = from;
  while (j < chars.length && /^[\p{L}\p{N}_-]$/u.test(chars[j])) j++;
  return j > from && chars[j] === ']';
}

/**
 * A `^` hidden from the parser as a literal token: when `[` follows it, or when `[` precedes it
 * and no footnote label follows. Neither is meaningful GFM or Atlas syntax; AtlasKit hides them
 * because cmark-gfm loses text around them, and hiding them here keeps both parsers agreeing.
 */
function isHiddenCaret(chars: string[], i: number): boolean {
  if (chars[i] !== '^') return false;
  if (chars[i + 1] === '[') return true;
  return i > 0 && chars[i - 1] === '[' && !isFootnoteLabel(chars, i + 1);
}

/** The end of a same-line code span starting at `i`, or null when the backtick run is literal. */
function codeSpanEnd(chars: string[], i: number): number | null {
  let n = 0;
  while (chars[i + n] === '`') n++;
  let j = i + n;
  while (j < chars.length) {
    const c = chars[j];
    if (isNewline(c)) return null;
    if (c === '`') {
      let m = 0;
      while (chars[j + m] === '`') m++;
      if (m === n) return j + m;
      j += m; continue;
    }
    j++;
  }
  return null;
}

/** The end of an autolink or HTML tag starting at `i`, on the same line. */
function tagEnd(chars: string[], i: number): number | null {
  const next = chars[i + 1];
  if (next === undefined || !(/^\p{L}$/u.test(next) || next === '/' || next === '!' || next === '?')) return null;
  for (let j = i + 1; j < chars.length; j++) {
    const c = chars[j];
    if (c === '>') return j + 1;
    if (c === '<' || isNewline(c)) return null;
  }
  return null;
}

/** §4.8 inline math, pandoc's rule, on one line. `$$x$$` is inline math too. */
function inlineMath(chars: string[], i: number): { end: number; token: Token } | null {
  const double = chars[i + 1] === '$';
  const start = i + (double ? 2 : 1);
  if (start >= chars.length || isWhitespace(chars[start]) || chars[start] === '$') return null;
  for (let j = start + 1; j < chars.length && !isNewline(chars[j]); j++) {
    if (chars[j] !== '$') continue;
    if (double) {
      if (chars[j + 1] === '$') return { end: j + 2, token: { kind: 'inlineMath', value: chars.slice(start, j).join(''), raw: chars.slice(i, j + 2).join('') } };
    } else if (!isWhitespace(chars[j - 1]) && chars[j - 1] !== '\\' && !isAsciiDigit(chars[j + 1])) {
      return { end: j + 1, token: { kind: 'inlineMath', value: chars.slice(start, j).join(''), raw: chars.slice(i, j + 1).join('') } };
    }
  }
  return null;
}

/** §4.2 / §4.3: `[[…]]` or `![[…]]` on one line, with raw content. */
function wikiLink(chars: string[], i: number): { end: number; token: Token } | null {
  const isEmbed = chars[i] === '!';
  const open = isEmbed ? i + 1 : i;
  if (chars[open] !== '[' || chars[open + 1] !== '[') return null;
  for (let j = open + 2; j + 1 < chars.length; j++) {
    const c = chars[j];
    if (isNewline(c) || c === '[') return null;
    if (c === ']') {
      if (chars[j + 1] !== ']') return null;
      const ref = parseWikiLink(chars.slice(open + 2, j).join(''));
      if (!ref) return null;
      const raw = chars.slice(i, j + 2).join('');
      return { end: j + 2, token: isEmbed ? { kind: 'embed', ref, raw } : { kind: 'wikiLink', ref, raw } };
    }
  }
  return null;
}

/** Splits wiki-link content into target, heading or block reference, and alias. */
export function parseWikiLink(inner: string): WikiLinkReference | null {
  const trim = (s: string) => s.replace(/^[ \t]+|[ \t]+$/g, '');
  let left = inner;
  let alias: string | null = null;
  const bar = inner.indexOf('|');
  if (bar >= 0) {
    // `\|` is the alias separator exactly like `|`.
    const end = bar > 0 && inner[bar - 1] === '\\' ? bar - 1 : bar;
    left = inner.slice(0, end);
    const a = trim(inner.slice(bar + 1));
    alias = a === '' ? null : a;
  }
  const ref: WikiLinkReference = { target: '', heading: null, blockId: null, alias };
  const hash = left.indexOf('#');
  if (hash >= 0) {
    ref.target = trim(left.slice(0, hash));
    const rest = left.slice(hash + 1);
    if (rest.startsWith('^')) {
      const id = trim(rest.slice(1));
      if (!id || !/^[A-Za-z0-9-]+$/.test(id)) return null;
      ref.blockId = id;
    } else {
      const heading = trim(rest);
      if (!heading || heading.includes('^')) return null;
      ref.heading = heading;
    }
  } else {
    ref.target = trim(left);
  }
  if (ref.target.includes('^')) return null;
  if (!ref.target && ref.heading === null && ref.blockId === null) return null;
  return ref;
}

/** The inline math at code point `i` of `chars` (§4.8), as the preprocessor reads it: where it ends and its value. */
export function inlineMathAt(chars: string[], i: number): { end: number; value: string } | null {
  const found = inlineMath(chars, i);
  return found && found.token.kind === 'inlineMath' ? { end: found.end, value: found.token.value } : null;
}
