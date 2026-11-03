import { parse } from '../parse';
import { matchKey } from '../tags';
import { childrenOf, withChildren, type MarkdownNode } from '../tree';
import { pageSyntax, type SyntaxBlock, type SyntaxSpan } from './pageSyntax';

/**
 * Turns unlinked mentions of a page into wiki links ("link it"): every place `name` appears as
 * a phrase in `source`'s plain text becomes `[[target]]`, keeping the words as written. Returns
 * the new text and how many mentions were linked, or null when there was nothing to link or the
 * result wouldn't read back as exactly those new links. AtlasKit's `linkingMentions`.
 *
 * Plain text only, found through the syntax map: not code, math, frontmatter or HTML, not
 * inside a link, wiki link, image, tag or footnote reference, and never across syntax
 * characters (`Pro**ject**`). Matching ignores case and diacritics, as search does, at word
 * boundaries. Blocks the syntax map couldn't align completely are left alone.
 *
 * A mention written exactly as the target (up to case) becomes `[[Mention]]`. Otherwise it
 * keeps its words as the alias: `[[Projects/Plan|plan]]`.
 */
export function linkingMentions(name: string, target: string, source: string): { text: string; linked: number } | null {
  const trimmed = name.replace(/^[ \t]+|[ \t]+$/g, '');
  if (trimmed === '' || target === '') return null;
  const needle = foldForSearch(trimmed).folded;
  if (needle === '') return null;
  const syntax = pageSyntax(source);

  const found: { from: number; to: number }[] = [];
  for (const block of syntax.blocks) {
    if (!block.isComplete || !isProse(block)) continue;
    const forbidden = block.spans.filter(excludesMentions);
    const window = foldForSearch(source.slice(block.from, block.to));
    let searchFrom = 0;
    for (;;) {
      const at = window.folded.indexOf(needle, searchFrom);
      if (at < 0) break;
      searchFrom = at + Math.max(needle.length, 1);
      // A match starts and ends on whole characters of the source.
      const start = window.starts.get(at);
      const end = window.ends.get(at + needle.length);
      if (start === undefined || end === undefined) continue;
      const from = block.from + start;
      const to = block.from + end;
      if (!isWordBoundaryBefore(source, from) || !isWordBoundaryAfter(source, to)) continue;
      if (forbidden.some((s) => s.from < to && from < s.to)) continue;
      found.push({ from, to });
    }
  }
  if (found.length === 0) return null;

  let text = source;
  for (const r of [...found].reverse()) {
    const written = source.slice(r.from, r.to);
    const link = matchKey(written) === matchKey(target) ? `[[${written}]]` : `[[${target}|${written}]]`;
    text = text.slice(0, r.from) + link + text.slice(r.to);
  }

  // Exactly `found.length` more wiki links to the target, and the rest of the page unchanged.
  const links = (node: MarkdownNode): number =>
    node.type === 'wikiLink' && matchKey(node.target) === matchKey(target) ? 1 : childrenOf(node).reduce((n, k) => n + links(k), 0);
  const before = parse(source);
  const after = parse(text);
  if (links(after) !== links(before) + found.length) return null;
  if (JSON.stringify(unlinking(after, target)) !== JSON.stringify(unlinking(before, target))) return null;
  return { text, linked: found.length };
}

/**
 * `text` folded for case- and diacritic-insensitive search, with where each source character's
 * folding starts and ends in it: `starts` maps a folded offset to the source offset of the
 * character it begins, `ends` a folded offset to the source offset after the character it ends.
 */
function foldForSearch(text: string): { folded: string; starts: Map<number, number>; ends: Map<number, number> } {
  let folded = '';
  const starts = new Map<number, number>();
  const ends = new Map<number, number>();
  let offset = 0;
  for (const ch of text) {
    const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (f !== '') {
      starts.set(folded.length, offset);
      folded += f;
      ends.set(folded.length, offset + ch.length);
    } else {
      // A combining mark folds away; a match ending before it still ends after it.
      ends.set(folded.length, offset + ch.length);
    }
    offset += ch.length;
  }
  return { folded, starts, ends };
}

const isWordCharacter = (ch: string): boolean => /[\p{L}\p{M}\p{N}_]/u.test(ch);

function isWordBoundaryBefore(text: string, i: number): boolean {
  if (i <= 0) return true;
  const code = text.charCodeAt(i - 1);
  const start = code >= 0xdc00 && code <= 0xdfff && i >= 2 ? i - 2 : i - 1;
  return !isWordCharacter(text.slice(start, i));
}

function isWordBoundaryAfter(text: string, i: number): boolean {
  if (i >= text.length) return true;
  return !isWordCharacter(String.fromCodePoint(text.codePointAt(i)!));
}

/** Blocks whose text can hold a mention: not code, math, frontmatter or HTML. */
function isProse(block: SyntaxBlock): boolean {
  return !['code', 'math', 'yaml', 'html', 'thematicBreak'].includes(block.node.type);
}

/** Text a mention must not touch. */
function excludesMentions(span: SyntaxSpan): boolean {
  return [
    'inlineCode', 'inlineMath', 'inlineHTML', 'codeBlock', 'mathBlock', 'frontmatter', 'htmlBlock',
    'link', 'image', 'wikiLink', 'embed', 'tag', 'footnoteReference', 'syntax',
  ].includes(span.kind.type);
}

/**
 * The tree with every wiki link to `target` turned back into the words it shows, and adjacent
 * text merged: a change that only linked words compares equal.
 */
function unlinking(node: MarkdownNode, target: string): MarkdownNode {
  const kids: MarkdownNode[] = [];
  for (const kid of childrenOf(node)) {
    const k: MarkdownNode =
      kid.type === 'wikiLink' && matchKey(kid.target) === matchKey(target) ? { type: 'text', value: kid.alias ?? kid.target } : unlinking(kid, target);
    const last = kids[kids.length - 1];
    if (k.type === 'text' && last?.type === 'text') kids[kids.length - 1] = { type: 'text', value: last.value + k.value };
    else kids.push(k);
  }
  if (node.type === 'callout') {
    const title = node.title && childrenOf(unlinking({ type: 'paragraph', blockId: null, children: node.title }, target));
    return { ...node, title, children: kids };
  }
  return childrenOf(node).length === 0 ? node : withChildren(node, kids);
}
