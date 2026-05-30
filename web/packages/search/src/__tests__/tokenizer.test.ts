import { describe, it, expect } from 'vitest';
import { normalizeText, hashToken, tokenize } from '../tokenizer';

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

describe('hashToken', () => {
  const key = new Uint8Array(32).fill(1);
  const key2 = new Uint8Array(32).fill(2);

  it('returns a hex string', async () => {
    const hash = await hashToken('budget', key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same token + key always produces same hash', async () => {
    const h1 = await hashToken('budget', key);
    const h2 = await hashToken('budget', key);
    expect(h1).toBe(h2);
  });

  it('different keys produce different hashes', async () => {
    const h1 = await hashToken('budget', key);
    const h2 = await hashToken('budget', key2);
    expect(h1).not.toBe(h2);
  });

  it('different tokens produce different hashes', async () => {
    const h1 = await hashToken('budget', key);
    const h2 = await hashToken('planning', key);
    expect(h1).not.toBe(h2);
  });
});

describe('tokenize', () => {
  const key = new Uint8Array(32).fill(5);

  it('returns an array of hex hashes', async () => {
    const hashes = await tokenize('Hello World', key);
    expect(hashes).toHaveLength(2);
    for (const h of hashes) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('is deterministic', async () => {
    const h1 = await tokenize('Hello World', key);
    const h2 = await tokenize('Hello World', key);
    expect(h1).toEqual(h2);
  });
});
