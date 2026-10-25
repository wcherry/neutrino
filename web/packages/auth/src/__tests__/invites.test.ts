/**
 * The invites client: each call hits its route with the right method and body,
 * list/send unwrap the `{ invites }` envelope, `inviteUrl` builds the sign-up
 * link, and the two additions to `authApi` (signupPolicy, inviteToken on
 * register).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const request = vi.fn();
vi.mock('@neutrino/api-core', () => ({
  request: (path: string, options?: RequestInit) => request(path, options),
  refreshTokens: vi.fn(),
  refreshTokensOnce: vi.fn(),
  ApiClientError: class extends Error {},
}));

import { invitesApi, inviteUrl } from '../invites';
import { authApi } from '../client';

function lastCall(): { path: string; method: string; body: unknown } {
  const [path, options] = request.mock.calls[request.mock.calls.length - 1] as [string, RequestInit | undefined];
  return {
    path,
    method: (options?.method ?? 'GET').toUpperCase(),
    body: typeof options?.body === 'string' ? JSON.parse(options.body) : undefined,
  };
}

const LINK = { token: 't', url: 'https://x.test/register?invite=t', expiresAt: '2026-11-07T00:00:00Z', useCount: 2 };
const INVITE = {
  id: 'i1',
  email: 'bob@example.com',
  status: 'pending',
  createdAt: '2026-10-24T00:00:00Z',
  expiresAt: '2026-11-07T00:00:00Z',
  acceptedAt: null,
};

describe('invitesApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getLink GETs /api/v1/invites/link', async () => {
    request.mockResolvedValue(LINK);

    const result = await invitesApi.getLink();

    expect(lastCall()).toMatchObject({ path: '/api/v1/invites/link', method: 'GET' });
    expect(result).toEqual(LINK);
  });

  it('resetLink POSTs /api/v1/invites/link/reset', async () => {
    request.mockResolvedValue(LINK);

    const result = await invitesApi.resetLink();

    expect(lastCall()).toMatchObject({ path: '/api/v1/invites/link/reset', method: 'POST' });
    expect(result).toEqual(LINK);
  });

  it('list GETs /api/v1/invites and unwraps .invites', async () => {
    request.mockResolvedValue({ invites: [INVITE] });

    const result = await invitesApi.list();

    expect(lastCall()).toMatchObject({ path: '/api/v1/invites', method: 'GET' });
    expect(result).toEqual([INVITE]);
  });

  it('send POSTs the addresses and note to /api/v1/invites and unwraps .invites', async () => {
    request.mockResolvedValue({ invites: [INVITE] });

    const result = await invitesApi.send({ emails: ['bob@example.com'], note: 'Hi' });

    expect(lastCall()).toEqual({
      path: '/api/v1/invites',
      method: 'POST',
      body: { emails: ['bob@example.com'], note: 'Hi' },
    });
    expect(result).toEqual([INVITE]);
  });

  it('send sends no note when none is given', async () => {
    request.mockResolvedValue({ invites: [] });

    await invitesApi.send({ emails: ['bob@example.com'] });

    expect(lastCall().body).toEqual({ emails: ['bob@example.com'] });
  });

  it('revoke DELETEs /api/v1/invites/{id}', async () => {
    request.mockResolvedValue(undefined);

    await invitesApi.revoke('i1');

    expect(lastCall()).toMatchObject({ path: '/api/v1/invites/i1', method: 'DELETE' });
  });

  it('validate POSTs the token to /api/v1/invites/validate', async () => {
    const validation = { kind: 'email', inviterName: 'Ada', email: 'bob@example.com', expiresAt: '2026-11-07T00:00:00Z' };
    request.mockResolvedValue(validation);

    const result = await invitesApi.validate('tok 1');

    expect(lastCall()).toEqual({
      path: '/api/v1/invites/validate',
      method: 'POST',
      body: { token: 'tok 1' },
    });
    expect(result).toEqual(validation);
  });

  it('propagates a failed request', async () => {
    request.mockRejectedValue(new Error('HTTP 429'));

    await expect(invitesApi.send({ emails: ['bob@example.com'] })).rejects.toThrow('HTTP 429');
  });
});

describe('inviteUrl', () => {
  it('builds a /register link on the given origin', () => {
    expect(inviteUrl('abc', 'https://neutrino.test')).toBe('https://neutrino.test/register?invite=abc');
  });

  it('URL-encodes the token', () => {
    expect(inviteUrl('a b/c+d=', 'https://neutrino.test')).toBe(
      'https://neutrino.test/register?invite=a%20b%2Fc%2Bd%3D',
    );
  });

  it('defaults to the page origin', () => {
    expect(inviteUrl('abc')).toBe(`${window.location.origin}/register?invite=abc`);
  });
});

describe('authApi additions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signupPolicy GETs /api/v1/auth/signup-policy', async () => {
    request.mockResolvedValue({ publicSignup: false });

    const result = await authApi.signupPolicy();

    expect(lastCall()).toMatchObject({ path: '/api/v1/auth/signup-policy', method: 'GET' });
    expect(result).toEqual({ publicSignup: false });
  });

  it('register passes inviteToken through in the body', async () => {
    request.mockResolvedValue({ id: 'u1', email: 'bob@example.com', name: 'Bob' });

    await authApi.register({ name: 'Bob', email: 'bob@example.com', password: 'pw-123456', inviteToken: 'tok' });

    expect(lastCall()).toEqual({
      path: '/api/v1/auth/register',
      method: 'POST',
      body: { name: 'Bob', email: 'bob@example.com', password: 'pw-123456', inviteToken: 'tok' },
    });
  });
});

describe('package index', () => {
  it('re-exports invitesApi and inviteUrl', async () => {
    const index = await import('../index');

    expect(index.invitesApi).toBe(invitesApi);
    expect(index.inviteUrl).toBe(inviteUrl);
  });
});
