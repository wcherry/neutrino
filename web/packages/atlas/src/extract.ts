import { parse as parseYaml } from 'yaml';
import { isValidTag, matchKey } from './tags';
import { childrenOf, plainText, type MarkdownNode, type WikiLinkReference } from './tree';

/** What one page contributes to the index (SPEC §6), shaped like the corpus's `extract.json`. */
export interface PageExtract {
  links: ({ kind: 'wiki' | 'markdown' } & WikiLinkReference)[];
  embeds: WikiLinkReference[];
  tags: string[];
  aliases: string[];
  headings: { depth: number; text: string }[];
  blockIds: string[];
}

export function extract(root: MarkdownNode): PageExtract {
  const out: PageExtract = { links: [], embeds: [], tags: [], aliases: [], headings: [], blockIds: [] };
  const seenTags = new Set<string>();
  const addTag = (name: string) => {
    const key = matchKey(name);
    if (!seenTags.has(key)) { seenTags.add(key); out.tags.push(name); }
  };
  const kids = childrenOf(root);
  // Frontmatter's tags come first, so read it before walking the body.
  if (kids[0]?.type === 'yaml') {
    const fm = frontmatter(kids[0].value);
    fm.tags.forEach(addTag);
    out.aliases = fm.aliases;
  }
  const ref = (n: WikiLinkReference): WikiLinkReference => ({ target: n.target, heading: n.heading, blockId: n.blockId, alias: n.alias });
  const walk = (node: MarkdownNode): void => {
    switch (node.type) {
      case 'wikiLink': out.links.push({ kind: 'wiki', ...ref(node) }); break;
      case 'link': {
        const r = internalPageReference(node.url);
        if (r) out.links.push({ kind: 'markdown', ...r });
        break;
      }
      case 'embed': out.embeds.push(ref(node)); break;
      case 'tag': addTag(node.name); break;
      case 'heading': out.headings.push({ depth: node.depth, text: plainText(node) }); break;
      case 'callout': node.title?.forEach(walk); break;
      default: break;
    }
    // A block's id; a wiki link's `blockId` is the one it points at, not its own.
    if (BLOCK_ID_HOLDERS.has(node.type) && 'blockId' in node && node.blockId !== null) out.blockIds.push(node.blockId);
    childrenOf(node).forEach(walk);
  };
  walk(root);
  return out;
}

/** The nodes that carry a block id of their own (§4.6). */
const BLOCK_ID_HOLDERS = new Set(['paragraph', 'table', 'code', 'blockquote', 'callout', 'list', 'math']);

const decode = (s: string): string | null => { try { return decodeURIComponent(s); } catch { return null; } };

/**
 * The page a standard link points at, if its url is an internal page reference (§6): no scheme,
 * not absolute or a bare fragment, and a path ending in `.md`.
 */
export function internalPageReference(url: string): WikiLinkReference | null {
  if (url.startsWith('/') || url.startsWith('#')) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)) return null;
  const hash = url.indexOf('#');
  const path = decode(hash >= 0 ? url.slice(0, hash) : url);
  if (path === null || !path.toLowerCase().endsWith('.md')) return null;
  const fragment = hash >= 0 ? decode(url.slice(hash + 1)) : null;
  const ref: WikiLinkReference = { target: path.slice(0, -3), heading: null, blockId: null, alias: null };
  if (fragment !== null && fragment.startsWith('^')) ref.blockId = fragment.slice(1);
  else ref.heading = fragment;
  return ref;
}

/**
 * The two frontmatter keys v1 interprets (§6). Anything unreadable contributes nothing: a page
 * must never fail to open because of its frontmatter. Read as YAML 1.1, as AtlasKit's Yams does.
 */
export function frontmatter(yaml: string): { tags: string[]; aliases: string[] } {
  let map: unknown;
  try { map = parseYaml(yaml, { version: '1.1' }); } catch { return { tags: [], aliases: [] }; }
  if (!map || typeof map !== 'object' || Array.isArray(map)) return { tags: [], aliases: [] };
  const m = map as Record<string, unknown>;
  const tag = (raw: string) => { const name = raw.startsWith('#') ? raw.slice(1) : raw; return isValidTag(name) ? name : null; };
  let tags: string[] = [];
  if (Array.isArray(m.tags)) tags = m.tags.filter((t): t is string => typeof t === 'string').map(tag).filter((t): t is string => t !== null);
  else if (typeof m.tags === 'string') tags = m.tags.split(/[,\s]+/u).filter(Boolean).map(tag).filter((t): t is string => t !== null);
  let aliases: string[] = [];
  if (Array.isArray(m.aliases)) aliases = m.aliases.filter((a): a is string => typeof a === 'string').map((a) => a.trim());
  else if (typeof m.aliases === 'string') aliases = [m.aliases.trim()];
  const seen = new Set<string>();
  aliases = aliases.filter((a) => a !== '' && !seen.has(a) && !!seen.add(a));
  return { tags, aliases };
}
