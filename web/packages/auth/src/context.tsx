'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi } from './client';
import { ensureE2EKeys } from './e2e-keys';
import { isCurrentUserAdmin } from './adminUtils';
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
      // Stamp admin status from the JWT claim so all consumers of useAuth
      // can check user.isAdmin without re-decoding the token themselves.
      profile.isAdmin = isCurrentUserAdmin();
      setUser(profile);
      ensureE2EKeys(profile.id).catch(() => {});
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
