import type { AiProvider } from '@neutrino/api-core';

/**
 * Where each provider hands out an API key.
 *
 * Every one of them needs a key — Gemini included. Its free tier is a free *key* with rate
 * limits, not anonymous access, and this field used to say "optional" for it, which sent people
 * to a request that could only fail at Google.
 */
export const AI_KEY_PAGES: Record<AiProvider, { url: string; label: string }> = {
  gemini: { url: 'https://aistudio.google.com/apikey', label: 'Google AI Studio' },
  claude: { url: 'https://console.anthropic.com/settings/keys', label: 'Anthropic Console' },
  openai: { url: 'https://platform.openai.com/api-keys', label: 'OpenAI Platform' },
};
