'use client';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single grammar issue found in a text string. */
export interface GrammarIssue {
  /** Character offset in the analysed string where the issue begins. */
  offset: number;
  /** Length of the problematic fragment in characters. */
  length: number;
  /** Human-readable description of the problem. */
  message: string;
  /** Optional replacement text. When present a "Fix" button is shown. */
  suggestion?: string;
}

// ── Rule implementations ──────────────────────────────────────────────────────

type Rule = (text: string) => GrammarIssue[];

/**
 * Rule 1 — Double word
 * Detects consecutive identical words (case-insensitive), e.g. "the the".
 */
const ruleDoubleWord: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  // Match two consecutive identical words separated by a single space.
  const re = /\b(\w+)\s+\1\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    issues.push({
      offset: m.index,
      length: m[0].length,
      message: `Repeated word detected: "${m[1]}"`,
      suggestion: m[1],
    });
  }
  return issues;
};

/**
 * Rule 2 — Article before vowel
 * Flags "a <vowel-starting word>" and suggests "an".
 * e.g. "a apple" → "an apple"
 */
const ruleArticleBeforeVowel: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  const re = /\ba\s+([aeiou]\w*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    issues.push({
      offset: m.index,
      length: m[0].length,
      message: `Use "an" before a vowel sound`,
      suggestion: `an ${m[1]}`,
    });
  }
  return issues;
};

/**
 * Rule 3 — Article before consonant
 * Flags "an <consonant-starting word>" and suggests "a".
 * e.g. "an book" → "a book"
 * Skips vowel-starting words to avoid clashing with rule 2.
 */
const ruleArticleBeforeConsonant: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  const re = /\ban\s+([^aeiou\s]\w*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    issues.push({
      offset: m.index,
      length: m[0].length,
      message: `Use "a" before a consonant sound`,
      suggestion: `a ${m[1]}`,
    });
  }
  return issues;
};

/**
 * Rule 4 — Repeated punctuation
 * Flags sequences of two or more identical punctuation characters that are not
 * an ellipsis ("...").
 * e.g. "!!" or ".." but NOT "..."
 */
const ruleRepeatedPunctuation: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  // Match 2+ identical punct chars; negative lookahead/behind prevents matching "..."
  const re = /([!?,;:])(\1+)|\.\.(?!\.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Exclude proper ellipsis (exactly three dots matched by the second branch)
    if (m[0] === '..') {
      // Only flag ".." that is NOT part of "..."
      const after = text[m.index + 2];
      if (after === '.') continue; // part of "..."
    }
    issues.push({
      offset: m.index,
      length: m[0].length,
      message: 'Repeated punctuation',
      suggestion: m[1] ?? '.',
    });
  }
  return issues;
};

/**
 * Rule 5 — Space before punctuation
 * Flags a whitespace character immediately before ".", "!", "?", "," or ";".
 * e.g. "Hello ." or "Great !"
 */
const ruleSpaceBeforePunctuation: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  const re = /\s+([.!?,;])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    issues.push({
      offset: m.index,
      length: m[0].length,
      message: 'Unnecessary space before punctuation',
      suggestion: m[1],
    });
  }
  return issues;
};

// ── Exported rule runner ──────────────────────────────────────────────────────

const RULES: Rule[] = [
  ruleDoubleWord,
  ruleArticleBeforeVowel,
  ruleArticleBeforeConsonant,
  ruleRepeatedPunctuation,
  ruleSpaceBeforePunctuation,
];

/**
 * applyGrammarRules
 *
 * Runs all grammar rules against `text` and returns the combined list of issues,
 * sorted by offset. Exported for direct use in unit tests.
 */
export function applyGrammarRules(text: string): GrammarIssue[] {
  if (!text) return [];
  const allIssues = RULES.flatMap((rule) => rule(text));
  allIssues.sort((a, b) => a.offset - b.offset);
  return allIssues;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useGrammarCheck
 *
 * A lightweight, purely client-side grammar checker. Runs heuristic rules
 * against the supplied text and returns an array of GrammarIssue objects.
 *
 * The rules are synchronous and run in the same render cycle — no async work,
 * no network calls, no external dependencies.
 *
 * @param text  The plain-text string to analyse. Pass an empty string or
 *              undefined to get an empty result immediately.
 * @returns     Array of GrammarIssue objects (empty when text is clean).
 */
export function useGrammarCheck(text: string | undefined): GrammarIssue[] {
  if (!text) return [];
  return applyGrammarRules(text);
}
