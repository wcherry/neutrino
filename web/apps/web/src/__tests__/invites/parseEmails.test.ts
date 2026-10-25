/**
 * `parseEmails` turns whatever was typed or pasted into the invite field into
 * addresses the server will take, and the leftovers it will not.
 */
import { describe, it, expect, vi } from 'vitest';

// The barrel also exports the panel and the hook; keep their API off the network.
vi.mock('@neutrino/auth', () => ({
  invitesApi: {
    getLink: vi.fn(),
    resetLink: vi.fn(),
    list: vi.fn(),
    send: vi.fn(),
    revoke: vi.fn(),
    validate: vi.fn(),
  },
  inviteUrl: (token: string) => `https://app.test/register?invite=${token}`,
}));

import { parseEmails } from '@/components/InviteFriends';

describe('parseEmails', () => {
  it('returns nothing for empty input', () => {
    expect(parseEmails('')).toEqual({ valid: [], invalid: [] });
  });

  it('returns nothing for whitespace and separators only', () => {
    expect(parseEmails('  , ;  \n\t ')).toEqual({ valid: [], invalid: [] });
  });

  it('accepts a single address', () => {
    expect(parseEmails('ada@example.com')).toEqual({ valid: ['ada@example.com'], invalid: [] });
  });

  it('splits on commas', () => {
    expect(parseEmails('ada@example.com,bob@example.com').valid).toEqual([
      'ada@example.com',
      'bob@example.com',
    ]);
  });

  it('splits on semicolons', () => {
    expect(parseEmails('ada@example.com;bob@example.com').valid).toEqual([
      'ada@example.com',
      'bob@example.com',
    ]);
  });

  it('splits on spaces, tabs and newlines', () => {
    expect(parseEmails('ada@example.com bob@example.com\tcat@example.com\ndan@example.com').valid).toEqual([
      'ada@example.com',
      'bob@example.com',
      'cat@example.com',
      'dan@example.com',
    ]);
  });

  it('trims around each address', () => {
    expect(parseEmails('  ada@example.com  ,   bob@example.com ').valid).toEqual([
      'ada@example.com',
      'bob@example.com',
    ]);
  });

  it('lower-cases addresses', () => {
    expect(parseEmails('Ada@Example.COM').valid).toEqual(['ada@example.com']);
  });

  it('de-duplicates, keeping the first occurrence order', () => {
    expect(parseEmails('bob@example.com, Ada@example.com, BOB@example.com, ada@example.com').valid).toEqual([
      'bob@example.com',
      'ada@example.com',
    ]);
  });

  it('separates invalid entries from valid ones', () => {
    const result = parseEmails('ada@example.com, not-an-email, bob@example.com, @nope');
    expect(result.valid).toEqual(['ada@example.com', 'bob@example.com']);
    expect(result.invalid).toEqual(['not-an-email', '@nope']);
  });

  it('treats an address without a domain dot as invalid', () => {
    expect(parseEmails('ada@localhost').valid).toEqual([]);
    expect(parseEmails('ada@localhost').invalid).toEqual(['ada@localhost']);
  });

  it('treats a missing local part or domain as invalid', () => {
    expect(parseEmails('ada@').invalid).toEqual(['ada@']);
    expect(parseEmails('@example.com').invalid).toEqual(['@example.com']);
  });
});
