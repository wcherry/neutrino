/**
 * `AuthProvider` mounts on `/sign-in` and `/register`, before there is a token,
 * and those pages hand off with a client-side `router.push`. So the provider has
 * to pick the session up when the tokens land, not only when it mounted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const getProfile = vi.fn();
const post = vi.fn();
vi.mock('@neutrino/api-core', () => ({
  request: (path: string) => post(path),
  refreshTokens: vi.fn(),
  ApiClientError: class extends Error {},
}));
vi.mock('@neutrino/e2e-crypto', () => ({ clearSession: vi.fn() }));

import { AuthProvider, useAuth } from '../context';
import { authApi } from '../client';

function Probe() {
  const { user, isLoading } = useAuth();
  return <div>{isLoading ? 'loading' : (user?.email ?? 'signed out')}</div>;
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    post.mockImplementation((path: string) => {
      if (path === '/api/v1/auth/me') return getProfile();
      if (path === '/api/v1/auth/login') {
        return Promise.resolve({ accessToken: 'a', refreshToken: 'r' });
      }
      return Promise.resolve(undefined);
    });
  });

  it('loads the profile when a sign-in happens under the mounted provider', async () => {
    getProfile.mockRejectedValueOnce(new Error('401'));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument());

    getProfile.mockResolvedValue({ id: 'u1', email: 'w@example.com', name: 'W', role: 'user' });
    await authApi.login({ email: 'w@example.com', password: 'pw' });

    // Without the login notification this stays 'signed out' for the whole
    // session, and every `useAuth()` consumer — the editors included — behaves
    // as though nobody is signed in.
    await waitFor(() => expect(screen.getByText('w@example.com')).toBeInTheDocument());
  });

  it('drops the profile on sign-out', async () => {
    getProfile.mockResolvedValue({ id: 'u1', email: 'w@example.com', name: 'W', role: 'user' });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('w@example.com')).toBeInTheDocument());

    getProfile.mockRejectedValue(new Error('401'));
    await authApi.logout();

    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument());
  });
});
