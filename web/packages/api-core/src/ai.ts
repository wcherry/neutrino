/**
 * AI provider settings, and the one completion endpoint every AI feature calls.
 *
 * The provider and API key are the user's own: they are entered in Settings → AI Assistant, kept
 * in this browser's `localStorage`, and sent with each AI request. The server holds no key of its
 * own — `ANTHROPIC_API_KEY` used to be one, which made every account spend on the deployer's key
 * and pinned the whole product to a single provider.
 *
 * The reader lives here, beside the request wrapper, so every `@neutrino/api-*` client can attach
 * credentials without the app passing them down through each call site. Forgetting them is what
 * makes an AI feature fail at the provider rather than at the settings page.
 */

import { request } from './client';

export type AiProvider = 'gemini' | 'claude' | 'openai';

export interface AiSettings {
  provider: AiProvider;
  apiKey: string;
}

/** Where the settings live. Read by the app's `useAiSettings` hook too — one key, one shape. */
export const AI_SETTINGS_STORAGE_KEY = 'neutrino.ai.settings';

/** Gemini is the default because it is the one provider with a free tier to sign up for. */
export const DEFAULT_AI_SETTINGS: AiSettings = { provider: 'gemini', apiKey: '' };

const PROVIDERS: AiProvider[] = ['gemini', 'claude', 'openai'];

export function readAiSettings(): AiSettings {
  if (typeof window === 'undefined') return DEFAULT_AI_SETTINGS;
  try {
    const raw = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_AI_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    return {
      // A stored provider that is no longer offered falls back rather than being sent on to a
      // server that would reject the whole request over it.
      provider: PROVIDERS.includes(parsed.provider as AiProvider)
        ? (parsed.provider as AiProvider)
        : DEFAULT_AI_SETTINGS.provider,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export function writeAiSettings(settings: AiSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A browser refusing storage is not worth failing a settings save over.
  }
}

/**
 * The credentials to merge into an AI request body.
 *
 * Every AI client method spreads this into its own body, so a new AI endpoint gets the user's
 * provider and key by construction.
 */
export function aiCredentials(): AiSettings {
  return readAiSettings();
}

export interface AiCompleteOptions {
  systemPrompt?: string;
  maxTokens?: number;
}

export const aiApi = {
  /**
   * Send a prompt to the configured provider and return its text.
   *
   * The general-purpose call, for AI features with no server-side logic of their own. The server
   * proxies it: the key goes to Neutrino over the same connection as everything else rather than
   * to a provider's origin from the page.
   */
  async complete(
    userMessage: string,
    { systemPrompt = '', maxTokens }: AiCompleteOptions = {},
  ): Promise<string> {
    const resp = await request<{ text: string }>('/api/v1/ai/complete', {
      method: 'POST',
      body: JSON.stringify({ ...aiCredentials(), systemPrompt, userMessage, maxTokens }),
    });
    return resp.text;
  },
};
