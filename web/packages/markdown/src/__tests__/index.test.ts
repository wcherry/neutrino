import { describe, it, expect } from 'vitest';
import { extractWikiLinks } from '../index';

// Ported from src/notes/service.rs's parse_wiki_links unit tests — link
// extraction is now frontend-owned since note content is E2EE-encrypted
// before it reaches the server.
describe('extractWikiLinks', () => {
  it('extracts multiple wiki-link titles', () => {
    const content = 'See [[Alpha]] and [[Beta]] for more.';
    expect(extractWikiLinks(content)).toEqual(['Alpha', 'Beta']);
  });

  it('returns an empty array when there are no links', () => {
    expect(extractWikiLinks('no links here')).toEqual([]);
  });

  it('trims whitespace inside the brackets', () => {
    expect(extractWikiLinks('[[ My Note ]]')).toEqual(['My Note']);
  });

  it('skips empty brackets', () => {
    expect(extractWikiLinks('[[]]')).toEqual([]);
  });
});
