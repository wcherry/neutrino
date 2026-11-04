import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown';
import type { Code, Construct, Effects, Extension, State, TokenizeContext } from 'micromark-util-types';
import type { MarkdownNode } from './tree';

/**
 * GFM extended autolinks (SPEC §2), exactly as cmark-gfm's `autolink.c` finds them, which is
 * what AtlasKit runs. micromark's own GFM autolinking differs from it in which character may
 * come before a link, where a link ends, and links inside brackets, so it isn't used:
 *
 * - `www.` and `http://`, `https://`, `ftp://` links are matched while inlines are parsed, on raw
 *   source: a link runs to the next space or `<`, then loses trailing punctuation, an unbalanced
 *   `)` and an entity-like `&name;`. A `www.` link needs whitespace, `*`, `_`, `~` or `(` (or
 *   nothing) before it; a scheme is every letter before `://`, and must be one of the three.
 *   Nothing is linked inside an open `[` or `![`.
 * - Email addresses are found afterwards, in text outside links (`emailAutolinks`).
 */

const isAsciiAlpha = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isAsciiAlnum = (c: number) => isAsciiAlpha(c) || (c >= 48 && c <= 57);
/** cmark_isspace: space, tab, line feed, vertical tab, form feed, carriage return. */
const isCmarkSpace = (c: number) => c === 32 || (c >= 9 && c <= 13);
/** cmark's punctuation: ASCII punctuation (C `ispunct`), or a Unicode `P*` character. */
const isCmarkPunct = (c: number) => (c < 128 ? (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126)
  : /^\p{P}$/u.test(String.fromCodePoint(c)));
const isHostChar = (c: number) => !isCmarkSpace(c) && !/^\s$/u.test(String.fromCodePoint(c)) && !isCmarkPunct(c);

/**
 * `check_domain`: the length of a valid domain at the start of `s` (code points), or 0. cmark
 * scans bytes and stops inside the first non-ASCII character, so a non-ASCII host character ends
 * the scan right after itself.
 */
function checkDomain(s: number[], allowShort: boolean): number {
  let i = 1, np = 0, uscore1 = 0, uscore2 = 0;
  for (; i < s.length - 1; i++) {
    if (s[i] === 92 /* \ */ && i < s.length - 2) i++;
    const c = s[i];
    if (c === 95 /* _ */) uscore2++;
    else if (c === 46 /* . */) { uscore1 = uscore2; uscore2 = 0; np++; }
    else if (c >= 128) { if (!isHostChar(c)) break; i++; break; }
    else if (!isHostChar(c) && c !== 45 /* - */) break;
  }
  if ((uscore1 > 0 || uscore2 > 0) && np <= 10) return 0;
  return allowShort ? i : np ? i : 0;
}

/** `autolink_delim`: where a link that runs to `end` really ends, trailing punctuation removed. */
function autolinkDelim(s: number[], end: number): number {
  let closing = 0, opening = 0;
  for (let i = 0; i < end; i++) {
    if (s[i] === 60 /* < */) { end = i; break; }
    if (s[i] === 40) opening++;
    else if (s[i] === 41) closing++;
  }
  while (end > 0) {
    const c = s[end - 1];
    if (c === 41 /* ) */) {
      if (closing <= opening) return end;
      closing--; end--;
    } else if ('?!.,:*_~\'"'.includes(String.fromCodePoint(c))) {
      end--;
    } else if (c === 59 /* ; */) {
      let newEnd = end - 2;
      while (newEnd > 0 && isAsciiAlpha(s[newEnd])) newEnd--;
      if (newEnd < end - 2 && s[newEnd] === 38 /* & */) end = newEnd; else end--;
    } else {
      return end;
    }
  }
  return end;
}

/** How long a `www.` link is at the start of `s`, or 0. */
export function wwwLinkLength(s: number[]): number {
  if (s.length < 4 || s[0] !== 119 || s[1] !== 119 || s[2] !== 119 || s[3] !== 46) return 0;
  let end = checkDomain(s, false);
  if (!end) return 0;
  while (end < s.length && !isCmarkSpace(s[end]) && s[end] !== 60) end++;
  return autolinkDelim(s, end);
}

/** How long an `http://`, `https://` or `ftp://` link is at the start of `s` (its scheme's first letter), or 0. */
export function urlLinkLength(s: number[]): number {
  let scheme = 0;
  while (scheme < s.length && isAsciiAlpha(s[scheme])) scheme++;
  const name = String.fromCharCode(...s.slice(0, scheme)).toLowerCase();
  if (!['http', 'https', 'ftp'].includes(name) || s[scheme] !== 58 || s[scheme + 1] !== 47 || s[scheme + 2] !== 47) return 0;
  const data = s.slice(scheme);  // from the `:`, as cmark sees it
  if (data.length < 4 || data.length <= 3 || !isHostChar(data[3])) return 0;
  const domain = checkDomain(data.slice(3), true);
  if (!domain) return 0;
  let end = 3 + domain;
  while (end < data.length && !isCmarkSpace(data[end]) && data[end] !== 60) end++;
  end = autolinkDelim(data, end);
  return end ? scheme + end : 0;
}

// MARK: micromark

type Context = TokenizeContext & { _labelStarts?: { _balanced?: boolean }[] };

/** cmark doesn't autolink inside an open `[` or `![`: one no `]` has closed yet. */
const inBracket = (self: Context) => (self._labelStarts ?? []).some((s) => !s._balanced);

/**
 * Reads ahead (without consuming) to the next space, `<` or the end of the text, into `into`,
 * with the space or `<` too: cmark's `check_domain` reads the rest of the text, and never looks
 * at its last character, so `www.` before a space is a domain but at the end it isn't.
 */
function scanner(into: number[]): Construct {
  return {
    partial: true,
    tokenize(effects: Effects, ok: State): State {
      const step: State = (code: Code) => {
        if (code === null || code < 0 || isCmarkSpace(code) || code === 60) {
          if (code !== null) into.push(code < 0 ? 32 : code);
          effects.exit('atlasScan');
          return ok(code);
        }
        into.push(code);
        effects.consume(code);
        return step;
      };
      return (code: Code) => { effects.enter('atlasScan'); return step(code); };
    },
  };
}

function autolink(kind: 'www' | 'url'): Construct {
  return {
    name: `atlasAutolink-${kind}`,
    tokenize(this: Context, effects: Effects, ok: State, nok: State): State {
      const self = this;
      const ahead: number[] = [];
      let remaining = 0;
      const consumeRest: State = (code: Code) => {
        if (remaining === 0) { effects.exit(kind === 'www' ? 'atlasAutolinkWww' : 'atlasAutolinkUrl'); return ok(code); }
        remaining--;
        effects.consume(code);
        return consumeRest;
      };
      const measured: State = (code: Code) => {
        const length = kind === 'www' ? wwwLinkLength(ahead) : urlLinkLength(ahead);
        if (!length) return nok(code);
        remaining = length;
        effects.enter(kind === 'www' ? 'atlasAutolinkWww' : 'atlasAutolinkUrl');
        return consumeRest(code);
      };
      return (code: Code) => {
        if (inBracket(self)) return nok(code);
        const previous = self.previous;
        if (kind === 'www') {
          if (previous !== null && previous >= 0 && !isCmarkSpace(previous) && !'*_~('.includes(String.fromCharCode(previous))) return nok(code);
        } else if (previous !== null && previous >= 0 && isAsciiAlpha(previous)) {
          // cmark takes every letter before `://` as the scheme: `xhttp://` is no link.
          return nok(code);
        }
        return effects.check(scanner(ahead), measured, nok)(code);
      };
    },
  };
}

/** The micromark extension: `www.` at `w`, schemes at their first letter. */
export function atlasAutolinks(): Extension {
  const www = autolink('www'), url = autolink('url');
  return { text: { 119: www, 104: url, 72: url, 102: url, 70: url } };
}

/**
 * Turns the tokens into links: the text is the source as written, and so is the url (`http://` +
 * it for `www.`). In a table cell, `\|` is `|`: cmark-gfm unescapes a cell's pipes before it
 * parses the cell's inlines.
 */
export function atlasAutolinksFromMarkdown(): FromMarkdownExtension {
  return {
    enter: {
      atlasAutolinkWww(token) {
        const raw = cellText(this.stack, this.sliceSerialize(token));
        this.enter({ type: 'link', url: 'http://' + raw, title: null, children: [{ type: 'text', value: raw }] }, token);
      },
      atlasAutolinkUrl(token) {
        const raw = cellText(this.stack, this.sliceSerialize(token));
        this.enter({ type: 'link', url: raw, title: null, children: [{ type: 'text', value: raw }] }, token);
      },
    },
    exit: {
      atlasAutolinkWww(token) { this.exit(token); },
      atlasAutolinkUrl(token) { this.exit(token); },
    },
  };
}

const cellText = (stack: { type: string }[], raw: string) => (stack.some((n) => n.type === 'tableCell') ? raw.replaceAll('\\|', '|') : raw);

// MARK: Email (cmark-gfm's `postprocess_text`)

/** Whether `protocol` ends just before the `:`-terminated rewind at `at`, with no letter or digit before it. */
function validateProtocol(protocol: string, s: string, at: number, rewind: number, maxRewind: number): boolean {
  const len = protocol.length;
  if (len > maxRewind - rewind) return false;
  if (s.slice(at - rewind - len, at - rewind) !== protocol) return false;
  if (len === maxRewind - rewind) return true;
  return !isAsciiAlnum(s.charCodeAt(at - rewind - len - 1));
}

/** Email autolinks in text outside links, found as cmark-gfm finds them after parsing. */
export function emailAutolinks(kids: MarkdownNode[]): MarkdownNode[] {
  return kids.flatMap((kid): MarkdownNode[] => {
    if (kid.type === 'link') return [kid];
    if (kid.type !== 'text') return 'children' in kid ? [{ ...kid, children: emailAutolinks(kid.children) } as MarkdownNode] : [kid];
    return emailsIn(kid.value);
  });
}

function emailsIn(text: string): MarkdownNode[] {
  // cmark scans UTF-8 bytes; every test here is ASCII, so UTF-16 units read the same way.
  const out: MarkdownNode[] = [];
  let data = text, offset = 0;
  for (;;) {
    if (offset >= data.length) break;
    const atIndex = data.indexOf('@', offset);
    if (atIndex < 0) break;
    let maxRewind = atIndex - offset;
    let autoMailto = true, isXmpp = false, rewind = 0, linkEnd = 0, np = 0;
    let restart = true;
    while (restart) {
      restart = false;
      autoMailto = true; isXmpp = false;
      const at = offset + maxRewind;
      for (rewind = 0; rewind < maxRewind; rewind++) {
        const c = data.charCodeAt(at - rewind - 1);
        if (isAsciiAlnum(c) || '.+-_'.includes(data[at - rewind - 1])) continue;
        if (data[at - rewind - 1] === ':') {
          if (validateProtocol('mailto:', data, at, rewind, maxRewind)) { autoMailto = false; continue; }
          if (validateProtocol('xmpp:', data, at, rewind, maxRewind)) { autoMailto = false; isXmpp = true; continue; }
        }
        break;
      }
      if (rewind === 0) break;
      np = 0;
      for (linkEnd = 1; linkEnd < data.length - at; linkEnd++) {
        const c = data.charCodeAt(at + linkEnd);
        if (isAsciiAlnum(c)) continue;
        if (c === 64 /* @ */) { offset += maxRewind + 1; maxRewind = linkEnd - 1; restart = true; break; }
        if (c === 46 && linkEnd < data.length - at - 1 && isAsciiAlnum(data.charCodeAt(at + linkEnd + 1))) np++;
        else if (c === 47 && isXmpp) continue;
        else if (c !== 45 && c !== 95) break;
      }
    }
    const at = offset + maxRewind;
    if (rewind === 0) { offset += maxRewind + 1; continue; }
    const last = data.charCodeAt(at + linkEnd - 1);
    if (linkEnd < 2 || np === 0 || (!isAsciiAlpha(last) && last !== 46)) { offset += maxRewind + linkEnd; continue; }
    const codes = Array.from(data.slice(at, at + linkEnd), (c) => c.charCodeAt(0));
    linkEnd = autolinkDelim(codes, linkEnd);
    if (linkEnd === 0) { offset += maxRewind + 1; continue; }
    const email = data.slice(at - rewind, at + linkEnd);
    if (at - rewind > 0) out.push({ type: 'text', value: data.slice(0, at - rewind) });
    out.push({ type: 'link', url: (autoMailto ? 'mailto:' : '') + email, title: null, children: [{ type: 'text', value: email }] });
    data = data.slice(at + linkEnd);
    offset = 0;
  }
  if (data) out.push({ type: 'text', value: data });
  return out;
}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    atlasScan: 'atlasScan';
    atlasAutolinkWww: 'atlasAutolinkWww';
    atlasAutolinkUrl: 'atlasAutolinkUrl';
    atlasCodeHold: 'atlasCodeHold';
  }
}
