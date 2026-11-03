import { headingKey } from '../anchors';
import { extract, type PageExtract } from '../extract';
import { parse } from '../parse';
import { LinkResolver } from '../resolve';
import { matchKey } from '../tags';
import { childrenOf, flankingText, type MarkdownNode, type WikiLinkReference } from '../tree';
import { FullTextTable, phrase, type Match, type Phrase, type Query } from './fts';

export type LinkKind = 'wiki' | 'markdown' | 'embed';

/** A link from one page to another, as indexed. */
export interface IndexedLink {
  /** The page the link is on. */
  source: string;
  kind: LinkKind;
  reference: WikiLinkReference;
  /** The file it resolves to (SPEC §7), or null if unresolved. */
  resolved: string | null;
}

/** Text around a search match. `matches` are the matched words' ranges in `text`, as UTF-16 offsets. */
export interface Snippet {
  text: string;
  matches: { start: number; end: number }[];
}

export interface SearchHit {
  path: string;
  title: string;
  snippet: Snippet;
}

/** A place where a page's title or alias appears in another page's text without a link. */
export interface Mention {
  source: string;
  /** The title or alias that appears. */
  name: string;
  snippet: Snippet;
}

export interface SwitcherHit {
  path: string;
  title: string;
  /** The alias that matched, if it was an alias rather than the title. */
  alias: string | null;
  score: number;
}

export interface Heading {
  depth: number;
  text: string;
}

interface LinkRow {
  rowid: number;
  ord: number;
  kind: LinkKind;
  reference: WikiLinkReference;
  targetKey: string;
  resolved: string | null;
}

interface PageRow {
  id: number;
  path: string;
  title: string;
  titleKey: string;
  modified: Date | null;
  links: LinkRow[];
  tags: { tag: string; key: string }[];
  aliases: string[];
  headings: Heading[];
  blockIds: string[];
  /** What the page was indexed from, for `indexedPages`. */
  extract: PageExtract;
}

/** What indexing a page takes once it's parsed: its extract (SPEC §6) and its search text. */
export interface ExtractedPage {
  extract: PageExtract;
  text: string;
}

/** FTS columns. */
const TITLE = 0, ALIASES = 1, BODY = 2;

/**
 * The index of one vault: what every page contributes (SPEC §6), resolved links (§7), and
 * full-text search. AtlasKit's `VaultIndex`, in memory: it lives only on the device and is
 * rebuilt from the pages when a vault opens, so neither the server nor the disk ever sees
 * titles, links, tags or text through it (neutrino-atlas.md, constraints 2 and 4).
 *
 * Where AtlasKit asks SQLite, this answers from maps, keeping SQLite's orders: rows by rowid,
 * text by code point (`BINARY`), `LIKE` ignoring case for ASCII only. Search is FTS5's, ported
 * in `fts.ts`.
 */
export class VaultIndex {
  private pagesByPath = new Map<string, PageRow>();
  private pagesByID = new Map<number, PageRow>();
  private files = new Set<string>();
  private resolverCache: LinkResolver | null = null;
  /** Inside `batch`: links are stored unresolved and resolved once at the end. */
  private deferringResolution = false;
  private fts = new FullTextTable([10, 5, 1]);
  private maxPageID = 0;
  private maxLinkRowid = 0;

  // ── Files and pages ─────────────────────────────────────────────────────────

  /**
   * Runs many updates as one: a first import, or a sync that brings in many pages. Link
   * resolution waits until the end, so the batch costs one resolution pass rather than one per
   * new file.
   */
  batch(body: () => void): void {
    const outer = !this.deferringResolution;
    this.deferringResolution = true;
    try {
      body();
    } finally {
      if (outer) {
        this.deferringResolution = false;
        this.resolveAllLinks();
      }
    }
  }

  private resolveAllLinks(): void {
    this.resolverCache = null;
    for (const page of this.pagesByID.values()) {
      for (const link of page.links) link.resolved = this.resolver.resolve(link.reference.target, page.path);
    }
  }

  /** Every indexed page with what it was indexed from, for an index cache. */
  indexedPages(): (ExtractedPage & { path: string })[] {
    return [...this.pagesByID.values()].map((p) => ({ path: p.path, extract: p.extract, text: this.fts.text(p.id, BODY) }));
  }

  /** The number of indexed pages. */
  get pageCount(): number {
    return this.pagesByPath.size;
  }

  /**
   * Records the vault's files that aren't pages (attachments), so links and embeds to them
   * resolve. Pages are recorded by `upsertPage`.
   */
  addFile(path: string): void {
    if (this.files.has(path)) return;
    this.files.add(path);
    this.fileSetChanged([VaultIndex.fileKey(path)]);
  }

  removeFile(path: string): void {
    if (VaultIndex.isPage(path)) return this.removePage(path);
    if (!this.files.delete(path)) return;
    this.fileSetChanged([VaultIndex.fileKey(path)]);
  }

  /** Indexes a page from its Markdown source, replacing what was indexed for it before. */
  upsertPage(path: string, source: string, modified: Date | null = null): void {
    this.upsertPageTree(path, parse(source), modified);
  }

  /** Indexes a page from its already-parsed tree. */
  upsertPageTree(path: string, tree: MarkdownNode, modified: Date | null = null): void {
    this.upsertExtracted(path, VaultIndex.extracted(tree), modified);
  }

  /** What `upsertPageTree` indexes for `tree`: kept by an index cache so a page needn't be parsed again. */
  static extracted(tree: MarkdownNode): ExtractedPage {
    return { extract: extract(tree), text: VaultIndex.searchText(tree) };
  }

  /** Indexes a page from what was extracted from it. */
  upsertExtracted(path: string, { extract: extracted, text }: ExtractedPage, modified: Date | null = null): void {
    const title = VaultIndex.title(path);
    const isNewFile = !this.files.has(path);
    const existing = this.pagesByPath.get(path);
    const page: PageRow = existing ?? {
      id: ++this.maxPageID, path, title, titleKey: '', modified, links: [], tags: [], aliases: [], headings: [], blockIds: [], extract: extracted,
    };
    if (existing) this.dropLinks(existing);
    Object.assign(page, { title, titleKey: matchKey(title), modified, extract: extracted });
    if (!existing) {
      this.pagesByPath.set(path, page);
      this.pagesByID.set(page.id, page);
    }
    this.files.add(path);
    if (isNewFile) this.resolverCache = null;

    const addLink = (kind: LinkKind, reference: WikiLinkReference) => {
      page.links.push({
        rowid: ++this.maxLinkRowid,
        ord: page.links.length,
        kind,
        reference,
        targetKey: VaultIndex.targetKey(reference.target),
        resolved: this.deferringResolution ? null : this.resolver.resolve(reference.target, path),
      });
    };
    for (const { kind, ...reference } of extracted.links) addLink(kind, reference);
    for (const embed of extracted.embeds) addLink('embed', embed);
    page.tags = extracted.tags.map((tag) => ({ tag, key: matchKey(tag) }));
    page.aliases = extracted.aliases;
    page.headings = extracted.headings;
    page.blockIds = extracted.blockIds;
    this.fts.set(page.id, [title, extracted.aliases.join('\n'), text]);
    // A new file can change what other pages' links resolve to.
    if (isNewFile) this.fileSetChanged([VaultIndex.fileKey(path)]);
  }

  removePage(path: string): void {
    const page = this.pagesByPath.get(path);
    if (!page) return;
    this.dropLinks(page);
    this.fts.delete(page.id);
    this.pagesByPath.delete(path);
    this.pagesByID.delete(page.id);
    if (page.id === this.maxPageID) this.maxPageID = Math.max(0, ...this.pagesByID.keys());
    this.files.delete(path);
    this.fileSetChanged([VaultIndex.fileKey(path)]);
  }

  /**
   * Renames or moves a page (or attachment) in the index. The pages that linked to it keep
   * their old link text until they are rewritten (`MarkdownDocument.rewriteLinksToRenamed`) and
   * re-indexed: call `pagesLinking` before renaming to find them.
   */
  renameFile(from: string, to: string): void {
    if (from === to) return;
    const page = this.pagesByPath.get(from);
    if (page) {
      const title = VaultIndex.title(to);
      this.pagesByPath.delete(from);
      page.path = to;
      page.title = title;
      page.titleKey = matchKey(title);
      this.pagesByPath.set(to, page);
      this.fts.set(page.id, [title, this.fts.text(page.id, ALIASES), this.fts.text(page.id, BODY)]);
      // A same-page link (empty target) resolves to its own page, wherever it moved.
      for (const link of page.links) if (link.reference.target === '') link.resolved = to;
    }
    this.files.delete(from);
    this.files.add(to);
    this.fileSetChanged([VaultIndex.fileKey(from), VaultIndex.fileKey(to)]);
  }

  // ── Resolution ──────────────────────────────────────────────────────────────

  private get resolver(): LinkResolver {
    return (this.resolverCache ??= new LinkResolver(this.files));
  }

  /** The file set changed: re-resolve exactly the links whose target names one of these files. */
  private fileSetChanged(keys: string[]): void {
    this.resolverCache = null;
    if (this.deferringResolution) return;
    const wanted = new Set(keys);
    for (const page of this.pagesByID.values()) {
      for (const link of page.links) {
        if (wanted.has(link.targetKey)) link.resolved = this.resolver.resolve(link.reference.target, page.path);
      }
    }
  }

  /** Forgets a page's links, keeping `maxLinkRowid` what SQLite's next rowid would be. */
  private dropLinks(page: PageRow): void {
    const hadMax = page.links.some((l) => l.rowid === this.maxLinkRowid);
    page.links = [];
    if (hadMax) {
      let max = 0;
      for (const p of this.pagesByID.values()) for (const l of p.links) if (l.rowid > max) max = l.rowid;
      this.maxLinkRowid = max;
    }
  }

  // ── Links ───────────────────────────────────────────────────────────────────

  /**
   * Links to `path` from other pages (and from itself, for heading links), grouped by page in
   * title order, links in document order. The backlinks panel, and what a rename must rewrite.
   */
  backlinks(path: string): IndexedLink[] {
    return this.links((_, link) => link.resolved === path);
  }

  /**
   * The pages with links to `path`: the pages to rewrite before `path` is renamed. Same-page
   * links don't count.
   */
  pagesLinking(path: string): string[] {
    const pages = new Set<string>();
    for (const page of this.pagesByID.values()) {
      if (page.links.some((l) => l.resolved === path && l.reference.target !== '')) pages.add(page.path);
    }
    return [...pages].sort(compareCodePoints);
  }

  /** The links on `path`, in document order. */
  outgoingLinks(path: string): IndexedLink[] {
    return this.links((page) => page.path === path);
  }

  /** Link targets that don't resolve, with how many links use each: pages to create. */
  unresolvedTargets(): { target: string; count: number }[] {
    // GROUP BY target_key, each group showing its first link's spelling (by rowid).
    const groups = new Map<string, { target: string; count: number; rowid: number }>();
    for (const page of this.pagesByID.values()) {
      for (const link of page.links) {
        if (link.resolved !== null || link.reference.target === '') continue;
        const group = groups.get(link.targetKey);
        if (!group) groups.set(link.targetKey, { target: link.reference.target, count: 1, rowid: link.rowid });
        else {
          group.count++;
          if (link.rowid < group.rowid) Object.assign(group, { target: link.reference.target, rowid: link.rowid });
        }
      }
    }
    return [...groups.values()]
      .sort((a, b) => b.count - a.count || compareCodePoints(a.target, b.target))
      .map(({ target, count }) => ({ target, count }));
  }

  private links(where: (page: PageRow, link: LinkRow) => boolean): IndexedLink[] {
    const rows: { page: PageRow; link: LinkRow }[] = [];
    for (const page of this.pagesByID.values()) for (const link of page.links) if (where(page, link)) rows.push({ page, link });
    rows.sort(
      (a, b) => compareCodePoints(a.page.titleKey, b.page.titleKey) || compareCodePoints(a.page.path, b.page.path) || a.link.ord - b.link.ord,
    );
    return rows.map(({ page, link }) => ({ source: page.path, kind: link.kind, reference: { ...link.reference }, resolved: link.resolved }));
  }

  // ── Unlinked mentions ───────────────────────────────────────────────────────

  /**
   * Pages that mention `path`'s title or one of its aliases as a phrase, but don't link to it
   * ("unlinked mentions"). Ordered by relevance.
   */
  unlinkedMentions(path: string, limit = 50): Mention[] {
    const page = this.pagesByPath.get(path);
    if (!page) return [];
    const names = [VaultIndex.title(path), ...page.aliases];
    const linking = new Set<number>();
    for (const p of this.pagesByID.values()) if (p.links.some((l) => l.resolved === path)) linking.add(p.id);

    const seen = new Set<number>();
    const out: Mention[] = [];
    for (const name of names) {
      if (name === '') continue;
      for (const m of this.fts.match({ all: [phrase(name, false, BODY)], none: [] }).slice(0, limit)) {
        if (m.rowid === page.id || linking.has(m.rowid) || seen.has(m.rowid)) continue;
        seen.add(m.rowid);
        out.push({ source: this.pagesByID.get(m.rowid)!.path, name, snippet: this.snippet(m) });
      }
    }
    return out.slice(0, limit);
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  /**
   * Full-text search. Words match as prefixes (`plan` finds "planning"), `"quoted phrases"`
   * exactly, `-word` excludes. `#tag` or `tag:tag` keeps pages with that tag or a tag nested
   * under it; `path:folder` keeps pages under that folder. Matching ignores case and
   * diacritics. Titles weigh more than aliases, and aliases more than body text. With only
   * filters, every matching page is returned in title order.
   */
  search(query: string, limit = 50): SearchHit[] {
    const parsed = parseSearchQuery(query);
    const keep = (page: PageRow) =>
      parsed.tags.every((tag) => {
        const key = matchKey(tag);
        return page.tags.some((t) => t.key === key || likePrefix(t.key, key + '/'));
      }) && parsed.folders.every((folder) => likePrefix(page.path, folder.endsWith('/') ? folder : folder + '/'));

    const fts = ftsQuery(parsed);
    if (fts) {
      const hits: SearchHit[] = [];
      for (const m of this.fts.match(fts)) {
        const page = this.pagesByID.get(m.rowid)!;
        if (!keep(page)) continue;
        hits.push({ path: page.path, title: page.title, snippet: this.snippet(m) });
        if (hits.length === limit) break;
      }
      return hits;
    }
    if (parsed.tags.length === 0 && parsed.folders.length === 0) return [];
    return [...this.pagesByID.values()]
      .filter(keep)
      .sort((a, b) => compareCodePoints(a.titleKey, b.titleKey) || a.id - b.id)
      .slice(0, limit)
      .map((page) => ({ path: page.path, title: page.title, snippet: { text: '', matches: [] } }));
  }

  private snippet(match: Match): Snippet {
    return snippetFromMarked(this.fts.snippet(match, BODY, '\u0001', '\u0002', '…', 12));
  }

  // ── Quick switcher ──────────────────────────────────────────────────────────

  /**
   * Pages whose title or alias fuzzily matches `query`, best first (the quick switcher). An
   * exact title beats a prefix, and a prefix beats anything else. Otherwise matches are scored
   * fzf-style: points per matched character, bonuses at word starts and for consecutive runs,
   * penalties for gaps and for long titles. A query with `/` also matches against the folder path.
   */
  quickSwitch(query: string, limit = 20): SwitcherHit[] {
    const q = matchKey(trimSpaces(query));
    if (q === '') return [];
    const best = new Map<string, SwitcherHit>();
    const consider = (page: PageRow, candidate: string, alias: string | null) => {
      const score = fuzzyScore(q, matchKey(candidate));
      if (score === null) return;
      if (score > (best.get(page.path)?.score ?? -Infinity)) best.set(page.path, { path: page.path, title: page.title, alias, score });
    };
    const pages = [...this.pagesByID.values()];
    for (const page of pages) {
      consider(page, page.title, null);
      if (q.includes('/')) consider(page, page.path.slice(0, -3), null);
    }
    for (const page of pages) for (const alias of page.aliases) consider(page, alias, alias);
    return [...best.values()].sort((a, b) => b.score - a.score || compareCodePoints(a.path, b.path)).slice(0, limit);
  }

  // ── Headings ────────────────────────────────────────────────────────────────

  /** The headings on `path`, in document order. */
  headings(path: string): Heading[] {
    return (this.pagesByPath.get(path)?.headings ?? []).map((h) => ({ ...h }));
  }

  /**
   * Headings to suggest after `[[Page#`: those `query` fuzzily matches, best first, or all of
   * them in document order when it's empty. Headings that would be written the same in a link
   * (`headingLinkText`) are suggested once, as the first resolves.
   */
  static matchingHeadings(headings: Heading[], query: string, limit = 20): Heading[] {
    const seen = new Set<string>();
    const unique = headings.filter((h) => {
      const key = headingKey(h.text);
      if (key === '' || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const q = matchKey(trimSpaces(query));
    if (q === '') return unique.slice(0, limit);
    return unique
      .map((h, i) => ({ h, i, score: fuzzyScore(q, headingKey(h.text)) }))
      .filter((x): x is { h: Heading; i: number; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.h)
      .slice(0, limit);
  }

  /**
   * `items` ranked by how well `query` matches the best of their `keys`, the way the quick
   * switcher ranks titles; items it doesn't match are left out, and ties keep the given order.
   * All of them, in order, for an empty query. For lists that aren't pages, such as commands.
   */
  static fuzzyMatching<T>(items: T[], query: string, keys: (item: T) => string[]): T[] {
    const q = matchKey(trimSpaces(query));
    if (q === '') return items;
    return items
      .map((item, i) => {
        const scores = keys(item).map((k) => fuzzyScore(q, matchKey(k))).filter((s): s is number => s !== null);
        return { item, i, score: scores.length ? Math.max(...scores) : null };
      })
      .filter((x): x is { item: T; i: number; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.item);
  }

  // ── Tags ────────────────────────────────────────────────────────────────────

  /**
   * Every tag with the number of pages using it, nested tags as written (`project/atlas`),
   * grouped case-insensitively under the alphabetically first spelling.
   */
  tags(): { tag: string; count: number }[] {
    const groups = new Map<string, { tag: string; pages: Set<number> }>();
    for (const page of this.pagesByID.values()) {
      for (const { tag, key } of page.tags) {
        const group = groups.get(key);
        if (!group) groups.set(key, { tag, pages: new Set([page.id]) });
        else {
          group.pages.add(page.id);
          if (compareCodePoints(tag, group.tag) < 0) group.tag = tag;
        }
      }
    }
    return [...groups.entries()]
      .sort(([a], [b]) => compareCodePoints(a, b))
      .map(([, g]) => ({ tag: g.tag, count: g.pages.size }));
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  static isPage(path: string): boolean {
    return path.toLowerCase().endsWith('.md');
  }

  /** A page's title: its file name without `.md` (titles are file names, as in Obsidian). */
  static title(path: string): string {
    const name = path.split('/').filter(Boolean).pop() ?? path;
    return VaultIndex.isPage(name) ? name.slice(0, -3) : name;
  }

  /** The key a link target is filed under for re-resolution: its last segment, as matched. */
  static targetKey(target: string): string {
    let last = target.split('/').filter(Boolean).pop() ?? target;
    if (VaultIndex.isPage(last)) last = last.slice(0, -3);
    return matchKey(last);
  }

  /** The same key for a file: its name, without `.md` for a page. */
  static fileKey(path: string): string {
    return VaultIndex.targetKey(path);
  }

  /**
   * The text full-text search sees: every block's plain text, one block per line, code and
   * math included, frontmatter left out (its tags and aliases are indexed on their own).
   */
  static searchText(tree: MarkdownNode): string {
    const lines: string[] = [];
    const walk = (node: MarkdownNode): void => {
      switch (node.type) {
        case 'yaml':
          return;
        case 'paragraph':
        case 'heading':
        case 'tableCell':
          lines.push(flankingText(node));
          return;
        case 'code':
        case 'math':
        case 'html':
          lines.push(node.value);
          return;
        case 'callout':
          if (node.title) lines.push(node.title.map(flankingText).join(''));
          node.children.forEach(walk);
          return;
        default:
          childrenOf(node).forEach(walk);
      }
    };
    walk(tree);
    return lines.join('\n');
  }
}

// ── Search queries ────────────────────────────────────────────────────────────

export interface SearchQuery {
  terms: { text: string; phrase: boolean; negated: boolean }[];
  tags: string[];
  folders: string[];
}

/** A query string split into its parts. Nothing the user types is read as FTS5 syntax. */
export function parseSearchQuery(query: string): SearchQuery {
  const out: SearchQuery = { terms: [], tags: [], folders: [] };
  const chars = Array.from(query);
  let i = 0;
  while (i < chars.length) {
    if (isWhitespace(chars[i])) { i++; continue; }
    let negated = false;
    if (chars[i] === '-' && i + 1 < chars.length && !isWhitespace(chars[i + 1])) { negated = true; i++; }
    if (chars[i] === '"') {
      i++;
      let text = '';
      while (i < chars.length && chars[i] !== '"') text += chars[i++];
      i++;
      if (text.trim() !== '') out.terms.push({ text, phrase: true, negated });
      continue;
    }
    let word = '';
    while (i < chars.length && !isWhitespace(chars[i])) word += chars[i++];
    const length = Array.from(word).length;
    const lower = word.toLowerCase();
    if (word.startsWith('#') && length > 1 && !negated) out.tags.push(word.slice(1));
    else if (lower.startsWith('tag:') && length > 4 && !negated) out.tags.push(word.slice(4).replace(/^#/, ''));
    else if (lower.startsWith('path:') && length > 5 && !negated) out.folders.push(word.slice(5));
    else out.terms.push({ text: word, phrase: false, negated });
  }
  return out;
}

/** The FTS query, or null when there are no positive terms (FTS5 can't express a query that only excludes). */
function ftsQuery(parsed: SearchQuery): Query | null {
  const all: Phrase[] = parsed.terms.filter((t) => !t.negated).map((t) => phrase(t.text, !t.phrase));
  if (all.length === 0) return null;
  return { all, none: parsed.terms.filter((t) => t.negated).map((t) => phrase(t.text)) };
}

/** From `snippet()` output, with matches marked by U+0001 … U+0002. */
export function snippetFromMarked(marked: string): Snippet {
  let text = '';
  const matches: { start: number; end: number }[] = [];
  let start: number | null = null;
  for (const c of marked) {
    if (c === '\u0001') start = text.length;
    else if (c === '\u0002' && start !== null) { matches.push({ start, end: text.length }); start = null; }
    else text += c;
  }
  return { text, matches };
}

// ── Fuzzy matching ────────────────────────────────────────────────────────────

/**
 * A match score, or null if `query` isn't a subsequence of `candidate`. Both already folded.
 * Compared by grapheme cluster, as Swift compares `Character`s.
 */
export function fuzzyScore(query: string, candidate: string): number | null {
  if (candidate === query) return 10_000;
  const c = graphemes(candidate);
  const q = graphemes(query);
  if (q.length <= c.length && q.every((g, i) => c[i] === g)) return 8_000 - c.length;
  // Leftmost subsequence match, scored like fzf.
  let score = 0, previous: string | null = null, inRun = false, gap = 0, want = 0;
  for (const ch of c) {
    if (want === q.length) break;
    if (ch === q[want]) {
      score += 16;
      if (previous === null || isBoundary(previous)) score += 8;
      if (inRun) score += 6;
      if (gap > 0) score -= 3 + (gap - 1);
      inRun = true;
      gap = 0;
      want++;
    } else {
      if (score > 0 || gap > 0) gap++;
      inRun = false;
    }
    previous = ch;
  }
  if (want < q.length) return null;
  return score - Math.trunc(c.length / 4);
}

const isBoundary = (c: string) => c === ' ' || c === '/' || c === '-' || c === '_' || c === '.';

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function graphemes(s: string): string[] {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(s) || !segmenter) return Array.from(s);
  return Array.from(segmenter.segment(s), (x) => x.segment);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** SQLite's `BINARY` order: code points (UTF-16 order puts astral characters too early). */
export function compareCodePoints(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i), y = b.charCodeAt(i);
    if (x === y) continue;
    // A surrogate (half of an astral character) sorts after every BMP character.
    const sx = x >= 0xd800 && x <= 0xdfff, sy = y >= 0xd800 && y <= 0xdfff;
    if (sx !== sy) return sx ? 1 : -1;
    return x - y;
  }
  return a.length - b.length;
}

/** `value LIKE prefix || '%'` with `prefix` escaped: ASCII letters match either case, nothing else does. */
function likePrefix(value: string, prefix: string): boolean {
  return value.length >= prefix.length && asciiLower(value.slice(0, prefix.length)) === asciiLower(prefix);
}

const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** Swift's `trimmingCharacters(in: .whitespaces)`: spaces and tabs, not newlines. */
const trimSpaces = (s: string) => s.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '');

/** Swift's `Character.isWhitespace`. */
const isWhitespace = (c: string) => /^[\s\u0085]$/u.test(c);
