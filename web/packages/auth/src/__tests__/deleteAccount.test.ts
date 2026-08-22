/**
 * Deleting an account is the one call that has to leave the browser signed out
 * of a session the server can no longer revoke on its own: the access token
 * stays cryptographically valid until it expires, so the tokens have to go with
 * the account. The mirror of that is the failure case — a delete that did not
 * happen must not sign anyone out.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const request = vi.fn();
vi.mock('@neutrino/api-core', () => ({
  request: (path: string, options?: RequestInit) => request(path, options),
  refreshTokens: vi.fn(),
  ApiClientError: class extends Error {},
}));

import { authApi } from '../client';

describe('authApi.deleteAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('access_token', 'a');
    localStorage.setItem('refresh_token', 'r');
  });

  it('deletes the signed-in account and clears the session', async () => {
    request.mockResolvedValue(undefined);

    await authApi.deleteAccount();

    expect(request).toHaveBeenCalledWith(
      '/api/v1/auth/me',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });

  it('keeps the session when the delete fails', async () => {
    request.mockRejectedValue(new Error('HTTP 500'));

    await expect(authApi.deleteAccount()).rejects.toThrow();

    // Throwing the user out of an account they still have would strand them on
    // the sign-in page with no way to find out the delete never landed.
    expect(localStorage.getItem('access_token')).toBe('a');
    expect(localStorage.getItem('refresh_token')).toBe('r');
  });
});
