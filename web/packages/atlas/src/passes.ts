import { mergeText, type TopLevelBlock } from './convert';
import { ESCAPED_CHARACTER, TOKEN_START, isReserved, placeholder, readToken, type Token } from './preprocess';
import { isValidTag, isTagScalar } from './tags';
import {
  acceptsStandaloneBlockId, carry, childrenOf, flankingText, isBlockContainer, sourceLines, standaloneIdLine, withBlockId, withChildren,
  type CalloutFold, type MarkdownNode,
} from './tree';

/**
 * Applies the Atlas extensions (SPEC §4) to the converted tree. A port of AtlasKit's
 * `ExtensionPasses`:
 * 1. **Inline pass**, per paragraph, heading and table cell: tokens become wiki links, embeds
 *    and inline math; `==highlights==` are paired; `#tags` are recognised; a trailing
 *    `^block-id` is lifted off each paragraph.
 * 2. **Block pass**: blockquotes starting `[!type]` become callouts, and standalone `^id`
 *    paragraphs attach to the block before them.
 * 3. **Restore pass**: escape markers and tokens left where the syntax isn't recognised (code,
 *    link text, URLs) turn back into their text, and adjacent text is merged.
 */
export class ExtensionPasses {
  /** The wiki link and embed tokens that became nodes, in tree order. */
  materialized: number[] = [];

  constructor(private tokens: Token[]) {}

  applyTopLevel(blocks: TopLevelBlock[]): TopLevelBlock[] {
    const out: TopLevelBlock[] = [];
    for (const { node, lines } of blocks) {
      const converted = this.block(node);
      const previous = out[out.length - 1];
      if (previous) {
        const attached = attachStandaloneIds([previous.node, converted]);
        if (attached.length === 1) {
          out[out.length - 1] = { node: attached[0], lines: [previous.lines[0], lines[1]] };
          continue;
        }
      }
      out.push({ node: converted, lines });
    }
    return out.map((b) => ({ node: this.restore(b.node), lines: b.lines }));
  }

  // MARK: Blocks

  private block(node: MarkdownNode): MarkdownNode {
    return carry(node, this.blockNode(node));
  }

  private blockNode(node: MarkdownNode): MarkdownNode {
    switch (node.type) {
      case 'paragraph':
        return trailingBlockId(carry(node, { type: 'paragraph', blockId: null, children: this.inline(node.children) }));
      case 'heading':
        return { ...node, children: this.inline(node.children) };
      case 'tableCell':
        return { ...node, children: this.inline(node.children) };
      case 'blockquote':
        return callout(carry(node, { ...node, children: attachStandaloneIds(node.children.map((c) => this.block(c))) }));
      case 'root': case 'listItem': case 'footnoteDefinition': case 'table': case 'tableRow': {
        const kids = node.children.map((c) => this.block(c));
        return withChildren(node, isBlockContainer(node) ? attachStandaloneIds(kids) : kids);
      }
      case 'list':
        return { ...node, children: node.children.map((c) => this.block(c)) };
      default:
        return node;
    }
  }

  // MARK: Inlines

  private inline(kids: MarkdownNode[]): MarkdownNode[] {
    const state = { previous: null as string | null };
    return tags(highlights(mergeAllText(this.expandTokens(mergeAllText(kids)))), state);
  }

  /** Tokens in text become wiki links, embeds and inline math; not inside link or image text (§4.2). */
  private expandTokens(kids: MarkdownNode[]): MarkdownNode[] {
    return kids.flatMap((kid) => {
      switch (kid.type) {
        case 'text': return this.split(kid.value);
        case 'emphasis': case 'strong': case 'delete': case 'highlight':
          return [{ ...kid, children: this.expandTokens(kid.children) }];
        default: return [kid];
      }
    });
  }

  private split(text: string): MarkdownNode[] {
    if (!text.includes(TOKEN_START)) return [{ type: 'text', value: text }];
    const cps = Array.from(text);
    const out: MarkdownNode[] = [];
    let run = '';
    for (let i = 0; i < cps.length;) {
      if (cps[i] !== TOKEN_START) { run += cps[i]; i++; continue; }
      const { index, next } = readToken(cps, i + 1, this.tokens.length);
      if (index === null) { run += cps.slice(i, next).join(''); i = next; continue; }
      i = next;
      const token = this.tokens[index];
      let node: MarkdownNode;
      switch (token.kind) {
        case 'wikiLink': node = { type: 'wikiLink', ...token.ref }; this.materialized.push(index); break;
        case 'embed': node = { type: 'embed', ...token.ref }; this.materialized.push(index); break;
        case 'inlineMath': node = { type: 'inlineMath', value: token.value }; break;
        default: run += placeholder(index); continue;  // restored once, by the restore pass
      }
      if (run) { out.push({ type: 'text', value: run }); run = ''; }
      out.push(node);
    }
    if (run) out.push({ type: 'text', value: run });
    return out;
  }

  // MARK: Restore

  private restore(node: MarkdownNode): MarkdownNode {
    return carry(node, this.restoreNode(node));
  }

  private restoreNode(node: MarkdownNode): MarkdownNode {
    const r = (s: string, c: Context) => this.restoreString(s, c);
    const kids = (k: MarkdownNode[]) => mergeText(k.map((n) => this.restore(n)));
    switch (node.type) {
      case 'text': return { type: 'text', value: r(node.value, 'text') };
      case 'code': return { ...node, lang: node.lang === null ? null : r(node.lang, 'url'), meta: node.meta === null ? null : r(node.meta, 'url'), value: r(node.value, 'raw') };
      case 'math': return { ...node, value: r(node.value, 'raw') };
      case 'inlineCode': return { type: 'inlineCode', value: r(node.value, 'raw') };
      case 'html': return { type: 'html', value: r(node.value, 'raw') };
      case 'link': return { ...node, url: r(node.url, 'url'), title: node.title === null ? null : r(node.title, 'url'), children: kids(node.children) };
      case 'image': return { ...node, url: r(node.url, 'url'), title: node.title === null ? null : r(node.title, 'url'), alt: r(node.alt, 'text') };
      case 'footnoteDefinition': return { ...node, identifier: r(node.identifier, 'url'), label: node.label === null ? null : r(node.label, 'url'), children: kids(node.children) };
      case 'footnoteReference': return { ...node, identifier: r(node.identifier, 'url'), label: node.label === null ? null : r(node.label, 'url') };
      case 'callout': return { ...node, title: node.title === null ? null : kids(node.title), children: kids(node.children) };
      default: return 'children' in node ? withChildren(node, kids(node.children)) : node;
    }
  }

  private restoreString(s: string, context: Context): string {
    let reserved = false;
    for (const c of s) if (isReserved(c.codePointAt(0)!)) { reserved = true; break; }
    if (!reserved) return s;
    const cps = Array.from(s);
    let out = '';
    for (let i = 0; i < cps.length;) {
      const c = cps[i];
      if (c === TOKEN_START) {
        const { index, next } = readToken(cps, i + 1, this.tokens.length);
        if (index !== null) {
          const t = this.tokens[index];
          out += t.kind === 'reference' ? (context === 'raw' ? t.raw : t.decoded) : t.raw;
        } else {
          out += cps.slice(i, next).join('');
        }
        i = next;
      } else if (ESCAPED_CHARACTER[c]) {
        // In text and URLs the parser would have processed the escape; in code it stays.
        if (context === 'raw') out += '\\';
        out += ESCAPED_CHARACTER[c];
        i++;
      } else {
        out += c;
        i++;
      }
    }
    return out;
  }
}

type Context = 'text' | 'url' | 'raw';

/** §4.6, trailing form: whitespace, `^`, then an id at the very end of a paragraph. */
function trailingBlockId(p: MarkdownNode): MarkdownNode {
  if (p.type !== 'paragraph') return p;
  const last = p.children[p.children.length - 1];
  if (last?.type !== 'text') return p;
  const m = /[ \t]+\^([A-Za-z0-9-]+)$/.exec(last.value);
  if (!m) return p;
  const rest = last.value.slice(0, m.index).replace(/[ \t]+$/, '');
  const kids = p.children.slice(0, -1);
  if (rest) kids.push({ type: 'text', value: rest });
  return carry(p, { type: 'paragraph', blockId: m[1], children: kids });
}

/** §4.6, standalone form: a paragraph that is only `^id`, after a table, code, quote, callout, list or math block. */
function attachStandaloneIds(kids: MarkdownNode[]): MarkdownNode[] {
  const out: MarkdownNode[] = [];
  for (const kid of kids) {
    const previous = out[out.length - 1];
    if (kid.type === 'paragraph' && kid.blockId === null && kid.children.length === 1 && kid.children[0].type === 'text') {
      const m = /^\^([A-Za-z0-9-]+)$/.exec(kid.children[0].value);
      if (m && previous && acceptsStandaloneBlockId(previous)) {
        out[out.length - 1] = carry(previous, withBlockId(previous, m[1]));
        const line = sourceLines.get(kid)?.[0];
        if (line !== undefined) standaloneIdLine.set(out[out.length - 1], line);
        continue;
      }
    }
    out.push(kid);
  }
  return out;
}

/** §4.7: a blockquote whose first paragraph starts with `[!type]`, an optional fold, then whitespace, a line ending or nothing. */
function callout(quote: MarkdownNode): MarkdownNode {
  if (quote.type !== 'blockquote') return quote;
  const firstPara = quote.children[0];
  if (firstPara?.type !== 'paragraph') return quote;
  const inline = firstPara.children;
  const firstText = inline[0];
  if (firstText?.type !== 'text' || !firstText.value.startsWith('[!')) return quote;
  const m = /^\[!([A-Za-z0-9_-]+)\]([+-]?)/.exec(firstText.value);
  if (!m) return quote;
  const rest = firstText.value.slice(m[0].length);
  if (rest && !/^\s/u.test(rest)) return quote;
  if (!rest && inline.length > 1) return quote;

  // Split the paragraph at its first line ending: before it is the title, after it the body.
  const line: MarkdownNode[] = [...(rest ? [{ type: 'text' as const, value: rest }] : []), ...inline.slice(1)];
  const title: MarkdownNode[] = [], body: MarkdownNode[] = [];
  let inBody = false;
  for (const n of line) {
    if (!inBody && n.type === 'text' && n.value.includes('\n')) {
      const nl = n.value.indexOf('\n');
      if (nl > 0) title.push({ type: 'text', value: n.value.slice(0, nl) });
      const after = n.value.slice(nl + 1);
      if (after) body.push({ type: 'text', value: after });
      inBody = true;
    } else if (inBody) {
      body.push(n);
    } else {
      title.push(n);
    }
  }
  if (title[0]?.type === 'text') {
    const trimmed = title[0].value.replace(/^[ \t]+/, '');
    if (!trimmed) title.shift(); else title[0] = { type: 'text', value: trimmed };
  }
  const children = quote.children.slice(1);
  let blockId: string | null = null;
  if (body.length) children.unshift({ type: 'paragraph', blockId: firstPara.blockId, children: body });
  else blockId = firstPara.blockId;
  if (body.length) carry(firstPara, children[0]);
  return carry(quote, {
    type: 'callout', calloutType: m[1], fold: (m[2] || null) as CalloutFold | null,
    title: title.length ? title : null, blockId, children,
  } as MarkdownNode);
}

/** The parser can leave one run of text as several text nodes; every extension matches across them. */
function mergeAllText(kids: MarkdownNode[]): MarkdownNode[] {
  return mergeText(kids.map((k) => ('children' in k && k.children.length ? withChildren(k, mergeAllText(k.children)) : k)));
}

const isWhitespaceChar = (c: string | undefined) => c !== undefined && /^\s$/u.test(c);
/** CommonMark's Unicode punctuation, used by the flanking rules. */
const isPunct = (c: string | undefined) => c !== undefined && /^[\p{P}\p{S}]$/u.test(c);

/** §4.5: `==` pairs with the left/right-flanking rules GFM uses for `~~`. */
function highlights(kids: MarkdownNode[]): MarkdownNode[] {
  type Item = { node: MarkdownNode } | { delim: true; canOpen: boolean; canClose: boolean };
  const nested = kids.map((kid) =>
    kid.type === 'emphasis' || kid.type === 'strong' || kid.type === 'delete' ? { ...kid, children: highlights(kid.children) } : kid);
  const pieces: Item[] = [];
  for (const kid of nested) {
    if (kid.type !== 'text' || !kid.value.includes('==')) { pieces.push({ node: kid }); continue; }
    let run = '';
    const chars = Array.from(kid.value);
    for (let i = 0; i < chars.length;) {
      if (chars[i] === '=') {
        let n = 0;
        while (chars[i + n] === '=') n++;
        if (n === 2) {
          if (run) { pieces.push({ node: { type: 'text', value: run } }); run = ''; }
          pieces.push({ delim: true, canOpen: false, canClose: false });
        } else {
          run += '='.repeat(n);
        }
        i += n;
      } else {
        run += chars[i]; i++;
      }
    }
    if (run) pieces.push({ node: { type: 'text', value: run } });
  }
  const lastChar = (i: number) => {
    if (i < 0) return undefined;
    const p = pieces[i];
    if ('node' in p) { const t = Array.from(flankingText(p.node)); return t[t.length - 1]; }
    return '=';
  };
  const firstChar = (i: number) => {
    if (i >= pieces.length) return undefined;
    const p = pieces[i];
    if ('node' in p) return Array.from(flankingText(p.node))[0];
    return '=';
  };
  pieces.forEach((p, i) => {
    if (!('delim' in p)) return;
    const before = lastChar(i - 1), after = firstChar(i + 1);
    const beforeSpace = before === undefined || isWhitespaceChar(before), afterSpace = after === undefined || isWhitespaceChar(after);
    const beforePunct = isPunct(before), afterPunct = isPunct(after);
    pieces[i] = {
      delim: true,
      canOpen: !afterSpace && (!afterPunct || beforeSpace || beforePunct),
      canClose: !beforeSpace && (!beforePunct || afterSpace || afterPunct),
    };
  });
  const out: MarkdownNode[] = [];
  let openAt: number | null = null;
  for (const p of pieces) {
    if ('node' in p) { out.push(p.node); continue; }
    if (p.canClose && openAt !== null && openAt < out.length) {
      const inner = out.splice(openAt);
      out.pop(); // the opener's text
      out.push({ type: 'highlight', children: inner });
      openAt = null;
    } else {
      out.push({ type: 'text', value: '==' });
      if (p.canOpen) openAt = out.length;
    }
  }
  return out;
}

/** §4.4: `#tag` where the `#` starts the block's plain text or follows whitespace. */
function tags(kids: MarkdownNode[], state: { previous: string | null }): MarkdownNode[] {
  const out: MarkdownNode[] = [];
  for (const kid of kids) {
    switch (kid.type) {
      case 'text': out.push(...tagsIn(kid.value, state)); break;
      case 'emphasis': case 'strong': case 'delete': case 'highlight':
        out.push({ ...kid, children: tags(kid.children, state) }); break;
      default: {
        const t = Array.from(flankingText(kid));
        if (t.length) state.previous = t[t.length - 1];
        out.push(kid);
      }
    }
  }
  return out;
}

const isTagChar = (c: string | undefined) => c !== undefined && Array.from(c).every((s) => isTagScalar(s.codePointAt(0)!));

function tagsIn(text: string, state: { previous: string | null }): MarkdownNode[] {
  const chars = Array.from(text);
  if (!text.includes('#')) {
    if (chars.length) state.previous = chars[chars.length - 1];
    return [{ type: 'text', value: text }];
  }
  const out: MarkdownNode[] = [];
  let run = '';
  for (let i = 0; i < chars.length;) {
    const c = chars[i];
    if (c === '#' && (state.previous === null || isWhitespaceChar(state.previous))) {
      let j = i + 1;
      while (j < chars.length) {
        if (isTagChar(chars[j])) j++;
        else if (chars[j] === '/' && isTagChar(chars[j + 1])) j++;
        else break;
      }
      const name = chars.slice(i + 1, j).join('');
      if (name && isValidTag(name)) {
        if (run) { out.push({ type: 'text', value: run }); run = ''; }
        out.push({ type: 'tag', name });
        state.previous = chars[j - 1];
        i = j;
        continue;
      }
    }
    run += c;
    state.previous = c;
    i++;
  }
  if (run) out.push({ type: 'text', value: run });
  return out;
}

export { childrenOf };
