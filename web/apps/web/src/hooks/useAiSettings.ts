/**
 * Read and write the AI provider settings behind Settings → AI Assistant.
 *
 * The provider is the synced `ai.provider` preference and the key is `ai.apiKey`, sealed in the
 * user's preference vault (`@neutrino/preferences`) — no longer plaintext in `localStorage`. The
 * API clients read the same values through `readAiSettings` in `@neutrino/api-core`, which the
 * app points at the store (`lib/preferencesSync.ts`), so this hook is a view of one value, not a
 * second copy of it.
 */
'use client';

import { useCallback, useMemo } from 'react';
import { readAiSettings, writeAiSettings } from '@neutrino/api-core';
import type { AiProvider, AiSettings } from '@neutrino/api-core';
import { usePreference, useVaultAvailable } from '@neutrino/preferences';

export type { AiProvider, AiSettings };

export function useAiSettings() {
  const [provider] = usePreference('ai.provider');
  const [apiKey] = usePreference('ai.apiKey');
  const vaultAvailable = useVaultAvailable();
  // While the vault is still closed the key lives in the legacy record; `readAiSettings` knows.
  const settings = useMemo<AiSettings>(
    () => (vaultAvailable ? { provider, apiKey } : { provider, apiKey: readAiSettings().apiKey }),
    [provider, apiKey, vaultAvailable],
  );

  const setSettings = useCallback((next: AiSettings) => {
    writeAiSettings(next);
  }, []);

  /** Returns the options to pass to an AI API call. */
  const getProviderOptions = useCallback(() => {
    return {
      provider: settings.provider,
      apiKey: settings.apiKey || undefined,
    };
  }, [settings]);

  return { settings, setSettings, getProviderOptions };
}
