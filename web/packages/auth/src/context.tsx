'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi } from './client';
import { clearSession } from '@neutrino/e2e-crypto';
import type { UserProfile } from './types';

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
