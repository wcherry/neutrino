'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi } from './client';
import { subscribeToAuthChanged } from './authEvents';
import { clearSession } from '@neutrino/e2e-crypto';
import type { UserProfile } from './types';

/**
 * Whether this browser holds anything that could stand for a session. The
 * sentinel strings are the ones `getAuthHeader` also rejects — `localStorage`
 * keeps whatever it is handed, and `String(undefined)` has been written here
 * before.
 */
function hasStoredToken(): boolean {
  return ['access_token', 'refresh_token'].some((key) => {
    const value = localStorage.getItem(key);
    return !!value && value !== 'undefined' && value !== 'null';
  });
}

// ---------------------------------------------------------------------------
// Auth context
// ---------------------------------------------------------------------------

interface AuthContextValue {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  refresh: async () => {},
  signOut: async () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export interface AuthProviderProps {
  children: React.ReactNode;
  /** Called when the user session expires or sign-out is triggered */
  onUnauthenticated?: () => void;
}

export function AuthProvider({ children, onUnauthenticated }: AuthProviderProps) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadUser = useCallback(async () => {
    // With no tokens at all there is no session to load, and asking anyway buys
    // a guaranteed 401 — which the API client answers by hard-redirecting to
    // /sign-in. That is right for a session that expired underneath the user
    // and wrong right after a deliberate sign-out or account deletion, where
    // the caller is already navigating somewhere of its own choosing and the
    // redirect races it. Only the both-missing case short-circuits: a lone
    // refresh token is still a session, and `request()` can trade it for a new
    // access token.
    if (typeof window !== 'undefined' && !hasStoredToken()) {
      setUser(null);
      setIsLoading(false);
      onUnauthenticated?.();
      return;
    }
    try {
      // request() handles 401 → refresh → retry automatically.
      const profile = await authApi.getProfile();
      profile.isAdmin = profile.role === 'admin';
      setUser(profile);
      // The E2EE key is no longer provisioned here — it needs the user to
      // choose or supply an unlock secret, which `E2EEUnlockGate` drives once
      // the shell has rendered.
    } catch {
      setUser(null);
      onUnauthenticated?.();
    } finally {
      setIsLoading(false);
    }
  }, [onUnauthenticated]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // A sign-in or sign-out that happens under a mounted provider — which is
  // every one of them, since `/sign-in` and `/register` hand off with
  // `router.push` — has to reach the context. See `authEvents`.
  useEffect(() => subscribeToAuthChanged(() => void loadUser()), [loadUser]);

  const refresh = useCallback(async () => {
    await loadUser();
  }, [loadUser]);

  const signOut = useCallback(async () => {
    await authApi.logout().catch(() => {});
    // Wipe the decrypted identity key before dropping the user — otherwise it
    // would still be in memory for whoever signs in next on this machine.
    clearSession();
    setUser(null);
    onUnauthenticated?.();
  }, [onUnauthenticated]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: user !== null,
        refresh,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// useUser hook — convenience wrapper
// ---------------------------------------------------------------------------

export function useUser(): UserProfile | null {
  const { user } = useAuth();
  return user;
}
