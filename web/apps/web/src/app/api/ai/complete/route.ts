import { NextRequest, NextResponse } from 'next/server';

export interface AiCompleteRequest {
  provider: 'gemini' | 'claude' | 'openai';
  apiKey?: string;
  systemPrompt: string;
  userMessage: string;
}

// ── Provider helpers ───────────────────────────────────────────────────────────

async function callGemini(apiKey: string | undefined, systemPrompt: string, userMessage: string): Promise<string> {
  if (!apiKey) throw new Error('A Gemini API key is required. Add one in Settings → AI Assistant.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: 512 },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Gemini error ${res.status}`);
  }
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
}

async function callClaude(apiKey: string, systemPrompt: string, userMessage: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Claude error ${res.status}`);
  }
  const data = await res.json() as { content?: { type: string; text?: string }[] };
  return data.content?.find(b => b.type === 'text')?.text?.trim() ?? '';
}

async function callOpenAI(apiKey: string, systemPrompt: string, userMessage: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 512,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `OpenAI error ${res.status}`);
  }
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as AiCompleteRequest;
    const { provider, apiKey, systemPrompt, userMessage } = body;

    if (!provider) {
      return NextResponse.json({ error: 'No AI provider specified' }, { status: 400 });
    }

    let text = '';

    if (provider === 'gemini') {
      text = await callGemini(apiKey, systemPrompt, userMessage);
    } else if (provider === 'claude') {
      if (!apiKey) return NextResponse.json({ error: 'Claude requires an API key. Add one in Settings → AI Assistant.' }, { status: 400 });
      text = await callClaude(apiKey, systemPrompt, userMessage);
    } else if (provider === 'openai') {
      if (!apiKey) return NextResponse.json({ error: 'OpenAI requires an API key. Add one in Settings → AI Assistant.' }, { status: 400 });
      text = await callOpenAI(apiKey, systemPrompt, userMessage);
    } else {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
    }

    return NextResponse.json({ text });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI request failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
