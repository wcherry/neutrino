/**
 * Unit tests for the client-side tag query parsing and matching used by the
 * topbar search. Drive content search runs in the browser (E2EE), so the tag
 * half of a query has to be resolved here too.
 */

import { describe, it, expect } from 'vitest';
import {
  intersectFileIds,
  matchTagsForTerm,
  parseTagQuery,
  resolveTagFilter,
} from '@/lib/tagSearch';
import type { Tag } from '@neutrino/api-drive';

function tag(id: string, name: string, fileCount = 1): Tag {
  return { id, name, fileCount, createdAt: '2026-01-01T00:00:00' };
}

const TAGS = [tag('t1', 'taxes'), tag('t2', 'travel'), tag('t3', 'Q1 report')];

describe('parseTagQuery', () => {
  it('splits tag filters from the free-text query', () => {
    const parsed = parseTagQuery('budget tag:taxes draft');
    expect(parsed.tagTerms).toEqual(['taxes']);
    expect(parsed.textQuery).toBe('budget draft');
    expect(parsed.hasExplicitTagFilter).toBe(true);
  });

  it('treats a query with no prefix as pure text', () => {
    const parsed = parseTagQuery('quarterly budget');
    expect(parsed.tagTerms).toEqual([]);
    expect(parsed.textQuery).toBe('quarterly budget');
    expect(parsed.hasExplicitTagFilter).toBe(false);
  });

  it('supports quoted tag names with spaces', () => {
    const parsed = parseTagQuery('tag:"Q1 report" summary');
    expect(parsed.tagTerms).toEqual(['Q1 report']);
    expect(parsed.textQuery).toBe('summary');
  });

  it('collects multiple tag filters', () => {
    const parsed = parseTagQuery('tag:taxes tag:travel');
    expect(parsed.tagTerms).toEqual(['taxes', 'travel']);
    expect(parsed.textQuery).toBe('');
  });

  it('ignores a bare tag: with no value', () => {
    const parsed = parseTagQuery('tag: something');
    expect(parsed.tagTerms).toEqual([]);
    expect(parsed.textQuery).toBe('something');
    expect(parsed.hasExplicitTagFilter).toBe(false);
  });

  it('matches the prefix case-insensitively', () => {
    expect(parseTagQuery('TAG:taxes').tagTerms).toEqual(['taxes']);
  });
});

describe('matchTagsForTerm', () => {
  it('matches case-insensitive substrings', () => {
    expect(matchTagsForTerm(TAGS, 'TAX').map((t) => t.id)).toEqual(['t1']);
    // "taxes" and "travel" both contain an "a"; "Q1 report" does not.
    expect(matchTagsForTerm(TAGS, 'a').map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('prefers an exact name match over substring hits', () => {
    const tags = [tag('a', 'work'), tag('b', 'workshop')];
    expect(matchTagsForTerm(tags, 'work').map((t) => t.id)).toEqual(['a']);
  });

  it('returns nothing for an empty term', () => {
    expect(matchTagsForTerm(TAGS, '   ')).toEqual([]);
  });
});

describe('resolveTagFilter', () => {
  it('returns one group per term', () => {
    const groups = resolveTagFilter(TAGS, ['taxes', 'travel']);
    expect(groups?.map((g) => g.map((t) => t.id))).toEqual([['t1'], ['t2']]);
  });

  it('returns null when a term matches no tag, so the result set is empty', () => {
    expect(resolveTagFilter(TAGS, ['taxes', 'nonexistent'])).toBeNull();
  });
});

describe('intersectFileIds', () => {
  it('keeps only ids present in every group', () => {
    const result = intersectFileIds([
      new Set(['a', 'b', 'c']),
      new Set(['b', 'c']),
      new Set(['c']),
    ]);
    expect([...result]).toEqual(['c']);
  });

  it('returns the single group unchanged', () => {
    expect([...intersectFileIds([new Set(['a', 'b'])])]).toEqual(['a', 'b']);
  });

  it('returns empty for no groups', () => {
    expect([...intersectFileIds([])]).toEqual([]);
  });
});
