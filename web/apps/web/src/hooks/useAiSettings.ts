/**
 * Hook for persisting AI provider settings in localStorage.
 *
 * Settings are stored under the key "neutrino.ai.settings" and include:
 *   - provider: 'claude' | 'openai' | 'gemini' (default: 'gemini' for free tier)
 *   - apiKey: string (optional — Gemini works without a key on free tier)
 */
'use client';

import { useState, useCallback } from 'react';

export type AiProvider = 'gemini' | 'claude' | 'openai';

export interface AiSettings {
  provider: AiProvider;
  apiKey: string;
}

const STORAGE_KEY = 'neutrino.ai.settings';

const DEFAULT_SETTINGS: AiSettings = {
  provider: 'gemini',
  apiKey: '',
};

function readSettings(): AiSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: AiSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

export function useAiSettings() {
  const [settings, setSettingsState] = useState<AiSettings>(readSettings);

  const setSettings = useCallback((next: AiSettings) => {
    writeSettings(next);
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
