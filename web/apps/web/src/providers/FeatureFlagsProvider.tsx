'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { type FeatureFlags, defaultFeatureFlags } from '@/lib/featureFlags';

type FeatureFlagsContextValue = {
  flags: FeatureFlags;
  loaded: boolean;
};

const FeatureFlagsContext = createContext<FeatureFlagsContextValue>({
  flags: defaultFeatureFlags,
  loaded: false,
});

export function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  const [flags, setFlags] = useState<FeatureFlags>(defaultFeatureFlags);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/v1/feature-flags')
      .then(r => r.json())
      .then(data => { setFlags(data); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  return (
    <FeatureFlagsContext.Provider value={{ flags, loaded }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlags(): FeatureFlags {
  return useContext(FeatureFlagsContext).flags;
}

export function useFeatureFlagsLoaded(): boolean {
  return useContext(FeatureFlagsContext).loaded;
}
