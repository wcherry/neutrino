import type { Tag } from '@neutrino/api-drive';

/**
 * Tag matching for the topbar search.
 *
 * Drive's search runs in the browser because file content is end-to-end
 * encrypted and the server cannot index it. Tag names *are* server-side
 * plaintext, but matching them here keeps one search path instead of two and
 * lets a tag filter compose with the encrypted content index — the server
 * could never do that half of the query.
 */

export interface ParsedTagQuery {
  /** Terms from explicit `tag:` prefixes. */
  tagTerms: string[];
  /** Everything else, for the encrypted content index. */
  textQuery: string;
  /** True when the user typed at least one `tag:` prefix. */
  hasExplicitTagFilter: boolean;
}

const TAG_PREFIX = /^tag:/i;

/**
 * Splits `budget tag:taxes` into a tag filter and a text query.
 * Supports quoting for tags with spaces: `tag:"q1 taxes"`.
 */
export function parseTagQuery(query: string): ParsedTagQuery {
  const tagTerms: string[] = [];
  const textParts: string[] = [];

  // Tokenise on whitespace but keep double-quoted runs together.
  const tokens = query.match(/(?:[^\s"]|"[^"]*")+/g) ?? [];

  for (const token of tokens) {
    if (TAG_PREFIX.test(token)) {
      const value = stripQuotes(token.replace(TAG_PREFIX, ''));
      if (value) tagTerms.push(value);
    } else {
      textParts.push(token);
    }
  }

  return {
    tagTerms,
    textQuery: textParts.join(' ').trim(),
    hasExplicitTagFilter: tagTerms.length > 0,
  };
}

function stripQuotes(value: string): string {
  return value.replace(/^"|"$/g, '').trim();
}

/**
 * Tags whose name matches a term, case-insensitively. An exact name match
 * wins outright; otherwise any substring hit counts, so `tag:tax` finds
 * "taxes".
 */
export function matchTagsForTerm(tags: Tag[], term: string): Tag[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];

  const exact = tags.filter((t) => t.name.toLowerCase() === needle);
  if (exact.length > 0) return exact;

  return tags.filter((t) => t.name.toLowerCase().includes(needle));
}

/**
 * Resolves every `tag:` term to tags. Returns one group per term — a file has
 * to match *some* tag in *every* group, so `tag:a tag:b` means "tagged both".
 *
 * Returns null when a term matches no tag at all: the query names a tag that
 * does not exist, so the correct result set is empty rather than unfiltered.
 */
export function resolveTagFilter(tags: Tag[], terms: string[]): Tag[][] | null {
  const groups: Tag[][] = [];
  for (const term of terms) {
    const matched = matchTagsForTerm(tags, term);
    if (matched.length === 0) return null;
    groups.push(matched);
  }
  return groups;
}

/**
 * Intersects per-group file id sets: a file must carry at least one tag from
 * each group.
 */
export function intersectFileIds(groups: Set<string>[]): Set<string> {
  if (groups.length === 0) return new Set();
  return groups.reduce((acc, group) => new Set([...acc].filter((id) => group.has(id))));
}
