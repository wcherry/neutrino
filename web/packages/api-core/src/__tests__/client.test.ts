import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ApiClientError,
  buildQuery,
  shouldSkipRefresh,
  getAuthHeader,
  clearAuthAndRedirect,
  refreshTokens,
  refreshTokensOnce,
} from '../client';

// ---------------------------------------------------------------------------
// ApiClientError
// ---------------------------------------------------------------------------

describe('ApiClientError', () => {
  it('is an instance of Error', () => {
    const err = new ApiClientError(404, 'NOT_FOUND', 'Resource not found');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiClientError);
  });

  it('sets name to ApiClientError', () => {
    const err = new ApiClientError(400, 'BAD_REQUEST', 'Bad request');
    expect(err.name).toBe('ApiClientError');
  });

  it('stores statusCode, code, and message', () => {
    const err = new ApiClientError(422, 'VALIDATION_ERROR', 'Invalid email');
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe('Invalid email');
  });

  it('works with different status codes', () => {
    expect(new ApiClientError(401, 'UNAUTHENTICATED', 'Unauthorized').statusCode).toBe(401);
    expect(new ApiClientError(500, 'SERVER_ERROR', 'Internal error').statusCode).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// buildQuery
// ---------------------------------------------------------------------------

describe('buildQuery', () => {
  it('returns empty string for an empty params object', () => {
    expect(buildQuery({})).toBe('');
  });

  it('returns empty string when all values are undefined', () => {
    expect(buildQuery({ a: undefined, b: undefined })).toBe('');
  });

  it('returns empty string when all values are empty strings', () => {
    expect(buildQuery({ search: '' })).toBe('');
  });

  it('builds a query string from a single numeric param', () => {
    expect(buildQuery({ page: 1 })).toBe('?page=1');
  });

  it('builds a query string from multiple params', () => {
    const result = buildQuery({ page: 1, pageSize: 20 });
    expect(result).toBe('?page=1&pageSize=20');
  });

  it('converts boolean values to strings', () => {
    expect(buildQuery({ active: true })).toBe('?active=true');
    expect(buildQuery({ active: false })).toBe('?active=false');
  });

  it('omits undefined values but keeps defined ones', () => {
    expect(buildQuery({ page: 2, filter: undefined })).toBe('?page=2');
  });

  it('handles string values', () => {
    expect(buildQuery({ sort: 'name' })).toBe('?sort=name');
  });
});

// ---------------------------------------------------------------------------
// shouldSkipRefresh
// ---------------------------------------------------------------------------

describe('shouldSkipRefresh', () => {
  it('returns true for the login path', () => {
    expect(shouldSkipRefresh('/api/v1/auth/login')).toBe(true);
  });

  it('returns true for the register path', () => {
    expect(shouldSkipRefresh('/api/v1/auth/register')).toBe(true);
  });

  it('returns true for the refresh path', () => {
    expect(shouldSkipRefresh('/api/v1/auth/refresh')).toBe(true);
  });

  it('returns false for unrelated auth paths', () => {
    expect(shouldSkipRefresh('/api/v1/auth/me')).toBe(false);
    expect(shouldSkipRefresh('/api/v1/auth/logout')).toBe(false);
  });

  it('returns false for non-auth paths', () => {
    expect(shouldSkipRefresh('/api/v1/drive/files')).toBe(false);
    expect(shouldSkipRefresh('/api/v1/photos')).toBe(false);
    expect(shouldSkipRefresh('/')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAuthHeader
// ---------------------------------------------------------------------------

describe('getAuthHeader', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns an empty object when no token is stored', () => {
    expect(getAuthHeader()).toEqual({});
  });

  it('returns an Authorization Bearer header when a token is stored', () => {
    localStorage.setItem('access_token', 'my.jwt.token');
    expect(getAuthHeader()).toEqual({ Authorization: 'Bearer my.jwt.token' });
  });

  it('returns an empty object when the stored value is the literal string "null"', () => {
    localStorage.setItem('access_token', 'null');
    expect(getAuthHeader()).toEqual({});
  });

  it('returns an empty object when the stored value is the literal string "undefined"', () => {
    localStorage.setItem('access_token', 'undefined');
    expect(getAuthHeader()).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// clearAuthAndRedirect
// ---------------------------------------------------------------------------

describe('clearAuthAndRedirect', () => {
  let assigned: string[];

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('access_token', 'a.b.c');
    localStorage.setItem('refresh_token', 'r.e.f');
    assigned = [];
    // jsdom's location is read-only, so stand in a minimal stub we can inspect.
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { pathname: '/', assign: (url: string) => assigned.push(url) },
    });
  });

  function visit(pathname: string) {
    (window.location as unknown as { pathname: string }).pathname = pathname;
    clearAuthAndRedirect();
  }

  it('always clears the stored tokens', () => {
    visit('/drive');
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });

  it('redirects to sign-in from an authenticated page', () => {
    visit('/drive');
    expect(assigned).toEqual(['/sign-in/']);
  });

  // A signed-out visitor reading the marketing pages must not be bounced away
  // from them by a background 401 — that made the landing page unreachable for
  // exactly the people it is written for.
  it.each(['/', '/self-host', '/self-host/', '/sign-in/', '/register/', '/share'])(
    'stays put on the public path %s',
    (pathname) => {
      visit(pathname);
      expect(assigned).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// refreshTokens
// ---------------------------------------------------------------------------

describe('refreshTokens', () => {
  const tokens = (n: number) => ({
    accessToken: `access-${n}`,
    refreshToken: `refresh-${n}`,
    tokenType: 'Bearer',
    expiresIn: 900,
  });

  function respond(body: unknown) {
    return { ok: true, json: async () => body } as Response;
  }

  function reject() {
    return { ok: false, json: async () => ({}) } as Response;
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('refresh_token', 'refresh-1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores the new pair and returns it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond(tokens(2))));

    const result = await refreshTokens();

    expect(result).toEqual(tokens(2));
    expect(localStorage.getItem('access_token')).toBe('access-2');
    expect(localStorage.getItem('refresh_token')).toBe('refresh-2');
  });

  it('sends the stored token, or the one it is given', async () => {
    const fetchMock = vi.fn(async () => respond(tokens(2)));
    vi.stubGlobal('fetch', fetchMock);

    await refreshTokens();
    await refreshTokens('handed-in');

    const sent = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse((init as RequestInit).body as string).refreshToken,
    );
    expect(sent).toEqual(['refresh-1', 'handed-in']);
  });

  // Rotation spends the token, so a second tab (or a phone on the same
  // account) refreshing at the same moment leaves this one holding a token the
  // server has already retired. Reporting failure would sign the user out and
  // take any long-running work — a Takeout import — down with it.
  it('retries with the newer token when another tab rotated underneath it', async () => {
    const fetchMock = vi
      .fn<(input: unknown, init?: RequestInit) => Promise<Response>>()
      // Stand in for the other tab: it wins the race and stores its pair while
      // our request is in flight, so ours comes back refused.
      .mockImplementationOnce(async () => {
        localStorage.setItem('refresh_token', 'refresh-9');
        return reject();
      })
      .mockImplementationOnce(async () => respond(tokens(10)));
    vi.stubGlobal('fetch', fetchMock);

    const result = await refreshTokens();

    expect(result).toEqual(tokens(10));
    expect(
      JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).refreshToken,
    ).toBe('refresh-9');
  });

  it('gives up when the refresh fails and nothing else rotated the token', async () => {
    const fetchMock = vi.fn(async () => reject());
    vi.stubGlobal('fetch', fetchMock);

    expect(await refreshTokens()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not call the server without a stored token', async () => {
    localStorage.removeItem('refresh_token');
    const fetchMock = vi.fn(async () => respond(tokens(2)));
    vi.stubGlobal('fetch', fetchMock);

    expect(await refreshTokens()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('refreshTokensOnce', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('refresh_token', 'refresh-1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // One tab refreshing itself twice is the race we *can* prevent, and must:
  // the second call would present a token the first has already spent.
  it('shares one request between concurrent callers', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({
            accessToken: 'access-2',
            refreshToken: 'refresh-2',
            tokenType: 'Bearer',
            expiresIn: 900,
          }),
        }) as Response,
    );
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([refreshTokensOnce(), refreshTokensOnce()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });
});
