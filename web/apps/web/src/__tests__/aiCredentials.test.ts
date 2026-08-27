/**
 * Every AI request carries the provider and key from Settings → AI Assistant.
 *
 * The server used to hold one `ANTHROPIC_API_KEY` for everybody. Now it holds none: each request
 * brings the caller's own credentials, and the clients attach them so no feature has to remember
 * to. These tests drive the real `request` wrapper against a stubbed `fetch`, so what they assert
 * is the body that actually goes on the wire.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  aiApi,
  aiCredentials,
  readAiSettings,
  writeAiSettings,
  AI_SETTINGS_STORAGE_KEY,
} from '@neutrino/api-core';
import { diagramsAI } from '@neutrino/api-diagrams';
import { sheetsAI } from '@neutrino/api-sheets';
import { slidesAI } from '@neutrino/api-slides';
import { photosAiApi } from '@neutrino/api-photos';

const fetchMock = vi.fn();

function lastRequest(): { url: string; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
  return { url, body: JSON.parse(init.body as string) as Record<string, unknown> };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ text: 'ok', shapes: [], connectors: [] }),
  });
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AI settings storage', () => {
  it('defaults to Gemini with no key', () => {
    expect(readAiSettings()).toEqual({ provider: 'gemini', apiKey: '' });
  });

  it('round-trips what the settings page saves', () => {
    writeAiSettings({ provider: 'claude', apiKey: 'sk-ant-test' });
    expect(readAiSettings()).toEqual({ provider: 'claude', apiKey: 'sk-ant-test' });
  });

  it('falls back when the stored provider is not one we offer', () => {
    localStorage.setItem(
      AI_SETTINGS_STORAGE_KEY,
      JSON.stringify({ provider: 'skynet', apiKey: 'k' }),
    );
    expect(readAiSettings()).toEqual({ provider: 'gemini', apiKey: 'k' });
  });

  it('survives a corrupt stored value', () => {
    localStorage.setItem(AI_SETTINGS_STORAGE_KEY, 'not json');
    expect(aiCredentials()).toEqual({ provider: 'gemini', apiKey: '' });
  });
});

describe('AI requests carry the configured credentials', () => {
  beforeEach(() => {
    writeAiSettings({ provider: 'openai', apiKey: 'sk-openai-test' });
  });

  it('aiApi.complete posts to the backend, not to a provider', async () => {
    await aiApi.complete('Fix this sentence', { systemPrompt: 'You are an editor', maxTokens: 64 });

    const { url, body } = lastRequest();
    expect(url).toBe('/api/v1/ai/complete');
    expect(body).toMatchObject({
      provider: 'openai',
      apiKey: 'sk-openai-test',
      systemPrompt: 'You are an editor',
      userMessage: 'Fix this sentence',
      maxTokens: 64,
    });
  });

  it('sends them with a diagram generation', async () => {
    await diagramsAI.generate('A CI/CD pipeline');
    const { url, body } = lastRequest();
    expect(url).toBe('/api/v1/diagrams/ai/generate');
    expect(body).toMatchObject({ provider: 'openai', apiKey: 'sk-openai-test', prompt: 'A CI/CD pipeline' });
  });

  it('sends them with a sheets question', async () => {
    await sheetsAI.explore('sheet-1', 'Which month is highest?', '[]');
    const { body } = lastRequest();
    expect(body).toMatchObject({ provider: 'openai', apiKey: 'sk-openai-test' });
  });

  it('sends them with slides compose', async () => {
    await slidesAI.complete('slides-1', 'Quarterly results');
    const { body } = lastRequest();
    expect(body).toMatchObject({ provider: 'openai', apiKey: 'sk-openai-test' });
  });

  it('sends them with a photos vision call', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ text: '' }) });
    await photosAiApi.ocr('AAAA', 'image/png');
    const { body } = lastRequest();
    expect(body).toMatchObject({ provider: 'openai', apiKey: 'sk-openai-test', imageBase64: 'AAAA' });
  });

  it('sends the empty key as-is, so the server can say which provider needs one', async () => {
    writeAiSettings({ provider: 'claude', apiKey: '' });
    await diagramsAI.generate('anything');
    const { body } = lastRequest();
    expect(body).toMatchObject({ provider: 'claude', apiKey: '' });
  });
});
