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
  /** Taxonomy category from the grammar spec. */
  category?: 'grammar' | 'punctuation' | 'spelling' | 'style' | 'clarity' | 'conciseness' | 'consistency' | 'readability';
}

// ── Rule implementations ──────────────────────────────────────────────────────

type Rule = (text: string) => GrammarIssue[];

// Rule 1 — Double word
const ruleDoubleWord: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  const re = /\b(\w+)\s+\1\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    issues.push({
      offset: m.index,
      length: m[0].length,
      message: `Repeated word: "${m[1]}"`,
      suggestion: m[1],
      category: 'consistency',
    });
  }
  return issues;
};

// Rule 2 — Article before vowel ("a apple" → "an apple")
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
      category: 'grammar',
    });
  }
  return issues;
};

// Rule 3 — Article before consonant ("an book" → "a book")
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
      category: 'grammar',
    });
  }
  return issues;
};

// Rule 4 — Repeated punctuation ("!!" but not "...")
const ruleRepeatedPunctuation: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  const re = /([!?,;:])(\1+)|(?<!\.)\.\./g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === '..') {
      const after = text[m.index + 2];
      if (after === '.') continue;
    }
    issues.push({
      offset: m.index,
      length: m[0].length,
      message: 'Repeated punctuation',
      suggestion: m[1] ?? '.',
      category: 'punctuation',
    });
  }
  return issues;
};

// Rule 5 — Space before punctuation ("Hello .")
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
      category: 'punctuation',
    });
  }
  return issues;
};

// ── New rules ─────────────────────────────────────────────────────────────────

// Rule 6 — its vs it's
// "its a/an/not/been/…" almost always means "it is/has" → "it's"
const ruleItsIts: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  const re = /\bits\s+(a\b|an\b|not\b|been\b|going\b|getting\b|just\b|never\b|always\b|only\b|really\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    issues.push({
      offset: m.index,
      length: m[0].length,
      message: `"its" is possessive — did you mean "it's" (it is/has)?`,
      suggestion: `it's ${m[1].toLowerCase()}`,
      category: 'spelling',
    });
  }
  return issues;
};

// Rule 7 — your vs you're
// "your welcome/right/going/…" → "you're"
const ruleYourYoure: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  const re = /\byour\s+(welcome\b|right\b|wrong\b|going\b|getting\b|doing\b|not\b|never\b|always\b|just\b|being\b|coming\b|making\b|trying\b|sure\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    issues.push({
      offset: m.index,
      length: m[0].length,
      message: `"your" is possessive — did you mean "you're" (you are)?`,
      suggestion: `you're ${m[1].toLowerCase()}`,
      category: 'spelling',
    });
  }
  return issues;
};

// Rule 8 — their vs they're
// "their going/not/a/…" → "they're"
const ruleTheirTheyre: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  const re = /\btheir\s+(going\b|getting\b|doing\b|not\b|a\b|an\b|being\b|coming\b|making\b|trying\b|never\b|always\b|just\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    issues.push({
      offset: m.index,
      length: m[0].length,
      message: `"their" is possessive — did you mean "they're" (they are)?`,
      suggestion: `they're ${m[1].toLowerCase()}`,
      category: 'spelling',
    });
  }
  return issues;
};

// Rule 9 — double negatives ("don't need no help")
const ruleDoubleNegative: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  const re =
    /\b(don't|doesn't|didn't|won't|wouldn't|can't|couldn't|shouldn't|haven't|hasn't|hadn't|isn't|aren't|wasn't|weren't|never)\b[^.!?]{0,40}\b(no\b|nothing\b|nobody\b|nowhere\b|none\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    issues.push({
      offset: m.index,
      length: m[0].length,
      message: `Double negative: "${m[1]}" and "${m[2]}" cancel each other out`,
      category: 'grammar',
    });
  }
  return issues;
};

// Rule 10 — incorrect pronoun case ("Me and Sarah went")
// Capital "Me and" is almost exclusively a sentence-start subject error.
const rulePronounCase: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  const re = /\bMe\s+and\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    issues.push({
      offset: m.index,
      length: m[0].length,
      message: `Use "I" not "Me" as the subject — try "… and I" or reorder`,
      suggestion: 'I and ',
      category: 'grammar',
    });
  }
  return issues;
};

// Rule 11 — passive voice (style suggestion)
// Heuristic: "was/were/is/are/am/been/being" + optional adverb + past participle (-ed).
// Excludes a set of common participial adjectives to reduce false positives.
const PASSIVE_ADJECTIVES = new Set([
  'excited', 'interested', 'tired', 'bored', 'confused', 'worried', 'concerned',
  'pleased', 'satisfied', 'surprised', 'amazed', 'amused', 'annoyed', 'disappointed',
  'embarrassed', 'frightened', 'frustrated', 'grateful', 'horrified', 'impressed',
  'irritated', 'overwhelmed', 'relaxed', 'relieved', 'shocked', 'stressed',
  'touched', 'troubled',
]);

const rulePassiveVoice: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  const re = /\b(was|were|is|are|am|been|being)\s+(?:\w+ly\s+)?(\w+ed)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (PASSIVE_ADJECTIVES.has(m[2].toLowerCase())) continue;
    issues.push({
      offset: m.index,
      length: m[0].length,
      message: 'Passive voice — consider active voice for clarity',
      category: 'style',
    });
  }
  return issues;
};

// Rule 12 — redundant phrases ("future plans" → "plans")
const REDUNDANT_PHRASES: Array<{ re: RegExp; suggestion: string }> = [
  { re: /\bfuture plans?\b/gi, suggestion: 'plans' },
  { re: /\bend result\b/gi, suggestion: 'result' },
  { re: /\bpast history\b/gi, suggestion: 'history' },
  { re: /\bcompletely finished\b/gi, suggestion: 'finished' },
  { re: /\badvance warning\b/gi, suggestion: 'warning' },
  { re: /\badded bonus\b/gi, suggestion: 'bonus' },
  { re: /\bclose proximity\b/gi, suggestion: 'proximity' },
  { re: /\bunexpected surprise\b/gi, suggestion: 'surprise' },
  { re: /\bfree gift\b/gi, suggestion: 'gift' },
  { re: /\bjoin together\b/gi, suggestion: 'join' },
  { re: /\bconsensus of opinion\b/gi, suggestion: 'consensus' },
  { re: /\beach and every\b/gi, suggestion: 'each' },
  { re: /\bnew innovation\b/gi, suggestion: 'innovation' },
  { re: /\bfinal outcome\b/gi, suggestion: 'outcome' },
  { re: /\bpast experience\b/gi, suggestion: 'experience' },
  { re: /\bbasic fundamentals?\b/gi, suggestion: 'fundamentals' },
];

const ruleRedundantPhrase: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  for (const { re, suggestion } of REDUNDANT_PHRASES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      issues.push({
        offset: m.index,
        length: m[0].length,
        message: `"${m[0]}" is redundant — consider "${suggestion}"`,
        suggestion,
        category: 'conciseness',
      });
    }
  }
  return issues;
};

// Rule 13 — wordy phrases ("in order to" → "to")
const WORDY_PHRASES: Array<{ re: RegExp; suggestion: string }> = [
  { re: /\bin order to\b/gi, suggestion: 'to' },
  { re: /\bdue to the fact that\b/gi, suggestion: 'because' },
  { re: /\bin the event that\b/gi, suggestion: 'if' },
  { re: /\bat this point in time\b/gi, suggestion: 'now' },
  { re: /\bon a daily basis\b/gi, suggestion: 'daily' },
  { re: /\bfor the purpose of\b/gi, suggestion: 'to' },
  { re: /\bwith the exception of\b/gi, suggestion: 'except' },
  { re: /\bin spite of the fact that\b/gi, suggestion: 'although' },
  { re: /\bwith regard to\b/gi, suggestion: 'regarding' },
  { re: /\bas a matter of fact\b/gi, suggestion: 'in fact' },
  { re: /\bin close proximity to\b/gi, suggestion: 'near' },
  { re: /\bprior to\b/gi, suggestion: 'before' },
  { re: /\bsubsequent to\b/gi, suggestion: 'after' },
  { re: /\bin the near future\b/gi, suggestion: 'soon' },
];

const ruleWordyPhrase: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  for (const { re, suggestion } of WORDY_PHRASES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      issues.push({
        offset: m.index,
        length: m[0].length,
        message: `Wordy — consider "${suggestion}"`,
        suggestion,
        category: 'conciseness',
      });
    }
  }
  return issues;
};

// Rule 14 — overused transition words (3+ occurrences of the same word)
const TRANSITION_WORDS = [
  'however', 'moreover', 'furthermore', 'additionally', 'consequently',
  'therefore', 'thus', 'hence', 'nevertheless', 'nonetheless',
] as const;

const TRANSITION_THRESHOLD = 3;

const ruleOverusedTransition: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  for (const word of TRANSITION_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, 'gi');
    const matches: RegExpExecArray[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) matches.push(m);
    if (matches.length >= TRANSITION_THRESHOLD) {
      for (const match of matches) {
        issues.push({
          offset: match.index,
          length: match[0].length,
          message: `"${word}" appears ${matches.length} times — vary your transition words`,
          category: 'style',
        });
      }
    }
  }
  return issues;
};

// Rule 15 — very long sentences (> 40 words)
const SENTENCE_WORD_LIMIT = 40;

const ruleLongSentence: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  const re = /[^.!?]+[.!?]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const wordCount = m[0].trim().split(/\s+/).filter(Boolean).length;
    if (wordCount > SENTENCE_WORD_LIMIT) {
      issues.push({
        offset: m.index,
        length: m[0].length,
        message: `Long sentence (${wordCount} words) — consider splitting it up`,
        category: 'readability',
      });
    }
  }
  return issues;
};

// Rule 16 — missing comma after introductory adverb ("However I think" → "However, I think")
const ruleIntroComma: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  const re =
    /\b(However|Therefore|Moreover|Furthermore|Additionally|Nevertheless|Nonetheless|Consequently|Otherwise|Meanwhile|Subsequently|Indeed)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const after = text.slice(m.index + m[0].length);
    // Flag only when the adverb is followed by a word with no intervening comma
    if (/^\s+[a-zA-Z]/.test(after) && !after.startsWith(',')) {
      issues.push({
        offset: m.index,
        length: m[0].length,
        message: `Add a comma after "${m[0]}" when used as an introductory adverb`,
        suggestion: `${m[0]},`,
        category: 'punctuation',
      });
    }
  }
  return issues;
};

// Rule 17 — who vs whom after a preposition ("to who" → "to whom")
const ruleWhoWhom: Rule = (text) => {
  const issues: GrammarIssue[] = [];
  const re =
    /\b(to|for|with|from|of|by|about|at|on|in|after|before|without|through|between|among|against|around|beside|beyond|during|except|over|since|toward|under|until|upon|within)\s+(who)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    issues.push({
      offset: m.index,
      length: m[0].length,
      message: `Use "whom" (not "who") after a preposition`,
      suggestion: `${m[1]} whom`,
      category: 'grammar',
    });
  }
  return issues;
};

// ── Rule runner ───────────────────────────────────────────────────────────────

const RULES: Rule[] = [
  ruleDoubleWord,
  ruleArticleBeforeVowel,
  ruleArticleBeforeConsonant,
  ruleRepeatedPunctuation,
  ruleSpaceBeforePunctuation,
  ruleItsIts,
  ruleYourYoure,
  ruleTheirTheyre,
  ruleDoubleNegative,
  rulePronounCase,
  rulePassiveVoice,
  ruleRedundantPhrase,
  ruleWordyPhrase,
  ruleOverusedTransition,
  ruleLongSentence,
  ruleIntroComma,
  ruleWhoWhom,
];

/**
 * applyGrammarRules
 *
 * Runs all grammar rules against `text` and returns the combined list of issues,
 * sorted by offset. Exported for direct use in unit tests.
 *
 * Curly apostrophes are normalised to ASCII before rule matching; offsets remain
 * valid because both are single code units.
 */
export function applyGrammarRules(text: string): GrammarIssue[] {
  if (!text) return [];
  // Normalise curly apostrophes so contraction rules match in rich-text editors.
  const normalised = text.replace(/[‘’]/g, "'");
  const allIssues = RULES.flatMap((rule) => rule(normalised));
  allIssues.sort((a, b) => a.offset - b.offset);
  return allIssues;
}

/**
 * useGrammarCheck
 *
 * A lightweight, purely client-side grammar checker. Runs heuristic rules
 * against the supplied text and returns an array of GrammarIssue objects.
 * No async work, no network calls, no external dependencies.
 *
 * @param text  The plain-text string to analyse.
 * @returns     Array of GrammarIssue objects (empty when text is clean).
 */
export function useGrammarCheck(text: string | undefined): GrammarIssue[] {
  if (!text) return [];
  return applyGrammarRules(text);
}
