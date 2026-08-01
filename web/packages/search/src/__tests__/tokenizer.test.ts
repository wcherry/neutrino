import { describe, it, expect } from 'vitest';
import { normalizeText, tokenizeWithPositions } from '../tokenizer';

describe('normalizeText', () => {
  it('lowercases input', () => {
    expect(normalizeText('Hello World')).toEqual(['hello', 'world']);
  });

  it('strips punctuation', () => {
    expect(normalizeText('Project Budget.xlsx')).toEqual(['project', 'budget', 'xlsx']);
  });

  it('deduplicates tokens', () => {
    const tokens = normalizeText('budget budget planning');
    expect(tokens.filter((t) => t === 'budget').length).toBe(1);
  });

  it('applies NFC normalization', () => {
    // café NFC vs NFD forms should normalize to same tokens
    const nfc = normalizeText('élève'); // é precomposed
    const nfd = normalizeText('élève'); // e + combining accent
    // after normalize('NFC') both become the same
    expect(nfc).toEqual(nfd);
  });

  it('removes empty tokens', () => {
    expect(normalizeText('  hello   world  ')).toEqual(['hello', 'world']);
  });

  it('handles empty string', () => {
    expect(normalizeText('')).toEqual([]);
  });
});

describe('tokenizeWithPositions', () => {
  it('stores terms as plain text, so an ordered index can range over them', () => {
    // The whole point of dropping the HMAC: "modesto" has to sort under the
    // "mod" prefix for `IDBKeyRange.bound` to reach it.
    const [term] = tokenizeWithPositions('Modesto');
    expect(term.term).toBe('modesto');
    expect(term.term.startsWith('mod')).toBe(true);
  });

  it('records every offset a repeated term appears at', () => {
    const terms = tokenizeWithPositions('budget planning budget');
    expect(terms.map((t) => t.term)).toEqual(['budget', 'planning']);
    expect(terms[0].positions).toEqual([0, 2]);
    expect(terms[1].positions).toEqual([1]);
  });

  it('positions count words, not characters, and skip punctuation', () => {
    const terms = tokenizeWithPositions('Q3 report — budget');
    expect(terms.map((t) => [t.term, t.positions])).toEqual([
      ['q3', [0]],
      ['report', [1]],
      ['budget', [2]],
    ]);
  });

  it('is case-insensitive', () => {
    expect(tokenizeWithPositions('Budget BUDGET budget')).toEqual([
      { term: 'budget', positions: [0, 1, 2] },
    ]);
  });

  it('handles empty input', () => {
    expect(tokenizeWithPositions('')).toEqual([]);
  });
});
