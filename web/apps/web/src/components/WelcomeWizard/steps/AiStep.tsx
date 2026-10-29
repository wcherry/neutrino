'use client';

/**
 * Step 4: the AI provider and key that every AI feature runs on — the same two settings as
 * Settings › AI Assistant (`useAiSettings`), so saving here is saving there.
 *
 * The key is saved when the user leaves the step, and only if one has been typed. "Test key" asks
 * the server's completion endpoint for one tiny reply with the key as typed, without saving it:
 * the provider's own answer (rejected key, quota, unreachable) comes back as the message.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@neutrino/ui';
import { aiApi } from '@neutrino/api-core';
import { useVaultAvailable } from '@neutrino/preferences';
import { useAiSettings, type AiProvider } from '@/hooks/useAiSettings';
import { AI_KEY_PAGES } from '@/lib/aiKeyPages';
import { InheritedNote, useLocked } from '@/app/(apps)/settings/InheritedNote';
import { useStep, useCommitOnLeave } from '../stepApi';
import styles from './Steps.module.css';

const PROVIDERS: { value: AiProvider; label: string }[] = [
  { value: 'gemini', label: 'Google Gemini (free tier available)' },
  { value: 'claude', label: 'Anthropic Claude' },
  { value: 'openai', label: 'OpenAI (GPT-4o)' },
];

type Test = { state: 'idle' } | { state: 'testing' } | { state: 'ok' } | { state: 'failed'; message: string };

export function AiStep() {
  const { markDone } = useStep();
  const { settings, setSettings } = useAiSettings();
  const providerLocked = useLocked('ai.provider');
  const vaultOpen = useVaultAvailable();
  const [provider, setProvider] = useState<AiProvider>(settings.provider);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [test, setTest] = useState<Test>({ state: 'idle' });
  // The stored values arrive after mount (the key is sealed in a vault that opens a moment
  // later); the draft follows them until the user starts typing.
  const edited = useRef(false);
  useEffect(() => {
    if (edited.current) return;
    setProvider(settings.provider);
    setApiKey(settings.apiKey);
  }, [settings.provider, settings.apiKey]);

  useCommitOnLeave(async () => {
    const key = apiKey.trim();
    // Empty means "set it up later": nothing is saved, and an existing key is left alone.
    if (!key) return false;
    if (key === settings.apiKey && provider === settings.provider) return false;
    setSettings({ provider, apiKey: key });
    edited.current = false;
    markDone();
    return true;
  });

  async function runTest() {
    const key = apiKey.trim();
    if (!key) return;
    setTest({ state: 'testing' });
    try {
      await aiApi.complete('Reply with the single word: ready', {
        maxTokens: 16,
        credentials: { provider, apiKey: key },
      });
      setTest({ state: 'ok' });
    } catch (e) {
      setTest({
        state: 'failed',
        message: e instanceof Error && e.message ? e.message : 'The provider did not accept this key.',
      });
    }
  }

  const page = AI_KEY_PAGES[provider];

  return (
    <div className={styles.stack}>
      <div className={styles.group}>
        <label className={styles.label} htmlFor="wizard-ai-provider">Provider</label>
        <select
          id="wizard-ai-provider"
          className={styles.select}
          value={provider}
          disabled={providerLocked}
          onChange={(e) => {
            edited.current = true;
            setProvider(e.target.value as AiProvider);
            setTest({ state: 'idle' });
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <InheritedNote prefKey="ai.provider" />
      </div>

      <div className={styles.group}>
        <label className={styles.label} htmlFor="wizard-ai-key">API key</label>
        <div className={styles.row}>
          <input
            id="wizard-ai-key"
            className={styles.input}
            type="password"
            value={apiKey}
            autoComplete="off"
            placeholder="Paste your key"
            onChange={(e) => {
              edited.current = true;
              setApiKey(e.target.value);
              setTest({ state: 'idle' });
            }}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void runTest()}
            disabled={!apiKey.trim()}
            loading={test.state === 'testing'}
          >
            Test key
          </Button>
        </div>
        <p role="status" className={styles.hint}>
          {test.state === 'ok' && <span className={styles.ok}><Check size={14} aria-hidden="true" /> Key works.</span>}
          {test.state === 'failed' && <span className={styles.error}>{test.message}</span>}
        </p>
        <p className={styles.hint}>
          Leave it empty to set it up later. Next saves a key you&rsquo;ve pasted.
        </p>
        <p className={styles.hint}>
          {vaultOpen
            ? 'Your key is sealed with your encryption key and synced to your other devices. Neutrino keeps no copy of it: it is passed to your provider with each request, and every account uses its own.'
            : 'Your key is kept in this browser. Neutrino keeps no copy of it: it is passed to your provider with each request, and every account uses its own.'}
        </p>
        <p className={styles.hint}>
          <a href={page.url} target="_blank" rel="noopener noreferrer">Where do I get a key?</a>{' '}
          Create one at {page.label}.
          {provider === 'gemini' && ' Gemini has a free tier, but it still needs a key.'}
        </p>
      </div>
    </div>
  );
}
