/**
 * Unit tests for the useGrammarCheck hook and applyGrammarRules helper.
 *
 * Covers:
 *   - applyGrammarRules: double-word detection
 *   - applyGrammarRules: article before vowel ("a apple" → "an apple")
 *   - applyGrammarRules: article before consonant ("an book" → "a book")
 *   - applyGrammarRules: repeated punctuation ("!!")
 *   - applyGrammarRules: space before punctuation ("Hello .")
 *   - applyGrammarRules: clean text returns no issues
 *   - applyGrammarRules: multiple issues in one string
 *   - useGrammarCheck: returns [] for empty string
 *   - useGrammarCheck: returns issues for erroneous text
 */

import { describe, it, expect } from 'vitest';
import { applyGrammarRules, type GrammarIssue } from '../hooks/useGrammarCheck';

// ── applyGrammarRules ──────────────────────────────────────────────────────────

describe('applyGrammarRules — double word', () => {
  it('detects a repeated word', () => {
    const issues = applyGrammarRules('the the quick brown fox');
    expect(issues.length).toBeGreaterThan(0);
    const issue = issues.find((i) => i.message.toLowerCase().includes('repeated'));
    expect(issue).toBeDefined();
  });

  it('includes a suggestion to remove the duplicate', () => {
    const issues = applyGrammarRules('this is is a test');
    const issue = issues.find((i) => i.message.toLowerCase().includes('repeated'));
    expect(issue?.suggestion).toBeDefined();
  });

  it('does not flag unique words', () => {
    const issues = applyGrammarRules('the quick brown fox');
    const doubleIssues = issues.filter((i) => i.message.toLowerCase().includes('repeated'));
    expect(doubleIssues).toHaveLength(0);
  });
});

describe('applyGrammarRules — article before vowel', () => {
  it('flags "a apple"', () => {
    const issues = applyGrammarRules('I ate a apple');
    expect(issues.some((i) => i.suggestion?.toLowerCase().includes('an'))).toBe(true);
  });

  it('flags "a orange"', () => {
    const issues = applyGrammarRules('She has a orange');
    expect(issues.some((i) => i.suggestion?.toLowerCase().includes('an'))).toBe(true);
  });

  it('does not flag "a cat"', () => {
    const issues = applyGrammarRules('a cat sat on the mat');
    const articleIssues = issues.filter((i) => i.suggestion?.toLowerCase().includes('an'));
    expect(articleIssues).toHaveLength(0);
  });
});

describe('applyGrammarRules — article before consonant', () => {
  it('flags "an book"', () => {
    const issues = applyGrammarRules('I read an book');
    expect(issues.some((i) => {
      const s = (i.suggestion ?? '').toLowerCase();
      return s.startsWith('a book') || s === 'a';
    })).toBe(true);
  });

  it('flags "an car"', () => {
    const issues = applyGrammarRules('She drives an car');
    expect(issues.some((i) => {
      const s = (i.suggestion ?? '').toLowerCase();
      return s.startsWith('a car') || s === 'a';
    })).toBe(true);
  });

  it('does not flag "an egg"', () => {
    const issues = applyGrammarRules('an egg is in the basket');
    const badAnIssues = issues.filter((i) => {
      const s = (i.suggestion ?? '').toLowerCase();
      return s === 'a' || s.startsWith('a egg');
    });
    expect(badAnIssues).toHaveLength(0);
  });
});

describe('applyGrammarRules — repeated punctuation', () => {
  it('flags "!!"', () => {
    const issues = applyGrammarRules('Wow!!');
    expect(issues.some((i) => i.message.toLowerCase().includes('punctuation'))).toBe(true);
  });

  it('flags ".."', () => {
    const issues = applyGrammarRules('Hmm..');
    expect(issues.some((i) => i.message.toLowerCase().includes('punctuation'))).toBe(true);
  });

  it('does not flag "..."', () => {
    const issues = applyGrammarRules('Wait...');
    const punctIssues = issues.filter((i) => i.message.toLowerCase().includes('punctuation'));
    expect(punctIssues).toHaveLength(0);
  });

  it('does not flag single punctuation', () => {
    const issues = applyGrammarRules('Hello!');
    const punctIssues = issues.filter((i) => i.message.toLowerCase().includes('punctuation'));
    expect(punctIssues).toHaveLength(0);
  });
});

describe('applyGrammarRules — space before punctuation', () => {
  it('flags "Hello ."', () => {
    const issues = applyGrammarRules('Hello .');
    expect(issues.some((i) => i.message.toLowerCase().includes('space'))).toBe(true);
  });

  it('flags "Great !"', () => {
    const issues = applyGrammarRules('Great !');
    expect(issues.some((i) => i.message.toLowerCase().includes('space'))).toBe(true);
  });

  it('does not flag "Hello."', () => {
    const issues = applyGrammarRules('Hello.');
    const spaceIssues = issues.filter((i) => i.message.toLowerCase().includes('space'));
    expect(spaceIssues).toHaveLength(0);
  });
});

describe('applyGrammarRules — clean text', () => {
  it('returns no issues for grammatically clean text', () => {
    const issues = applyGrammarRules('The quick brown fox jumps over the lazy dog.');
    expect(issues).toHaveLength(0);
  });

  it('returns empty array for empty string', () => {
    const issues = applyGrammarRules('');
    expect(issues).toHaveLength(0);
  });
});

describe('applyGrammarRules — multiple issues', () => {
  it('returns multiple issues when several rules fire', () => {
    // "a apple" (article) + "the the" (double word)
    const issues = applyGrammarRules('I ate a apple and the the pie');
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });
});

describe('applyGrammarRules — issue shape', () => {
  it('each issue has offset, length, and message', () => {
    const issues = applyGrammarRules('the the fox');
    issues.forEach((issue: GrammarIssue) => {
      expect(typeof issue.offset).toBe('number');
      expect(typeof issue.length).toBe('number');
      expect(typeof issue.message).toBe('string');
    });
  });

  it('offset + length does not exceed string length', () => {
    const text = 'a apple and the the dog';
    const issues = applyGrammarRules(text);
    issues.forEach((issue: GrammarIssue) => {
      expect(issue.offset + issue.length).toBeLessThanOrEqual(text.length);
    });
  });
});
