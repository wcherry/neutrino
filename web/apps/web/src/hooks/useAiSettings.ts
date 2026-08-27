/**
 * Read and write the AI provider settings behind Settings → AI Assistant.
 *
 * The storage itself lives in `@neutrino/api-core` (`neutrino.ai.settings`), because that is where
 * the API clients read it from when they attach credentials to an AI request — this hook is the
 * settings page's view of the same value, not a second copy of it.
 */
'use client';

import { useState, useCallback } from 'react';
import { readAiSettings, writeAiSettings } from '@neutrino/api-core';
import type { AiProvider, AiSettings } from '@neutrino/api-core';

export type { AiProvider, AiSettings };

export function useAiSettings() {
  const [settings, setSettingsState] = useState<AiSettings>(readAiSettings);

  const setSettings = useCallback((next: AiSettings) => {
    writeAiSettings(next);
    setSettingsState(next);
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
