import { NextRequest, NextResponse } from 'next/server';
import type { DiagramShape, DiagramConnector } from '@/app/(apps)/diagrams/types';

const SYSTEM_PROMPT = `You are a diagram generation assistant. Given a description, produce a JSON object with two arrays:
- "shapes": array of DiagramShape objects
- "connectors": array of DiagramConnector objects

Each shape must have: id (short slug like "s1"), type (one of: rectangle, rounded-rectangle, ellipse, diamond, flowchart-process, flowchart-decision, flowchart-terminator, network-server, network-database, network-cloud, bpmn-task, bpmn-gateway-exclusive), x, y, width, height, label.
Each connector must have: id, type ("straight"), sourceId, targetId, label (may be empty string).

Position shapes in a readable layout: x range 60–800, y range 60–600, width 120, height 60.
Return ONLY valid JSON, no markdown, no explanation.`;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json() as { prompt?: string };
    const { prompt } = body;

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AI diagram generation requires ANTHROPIC_API_KEY to be configured.' }, { status: 503 });
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(err.error?.message ?? `Claude error ${res.status}`);
    }

    const data = await res.json() as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((b) => b.type === 'text')?.text?.trim() ?? '{}';

    const parsed = JSON.parse(text) as { shapes?: Partial<DiagramShape>[]; connectors?: Partial<DiagramConnector>[] };

    return NextResponse.json({
      shapes: parsed.shapes ?? [],
      connectors: parsed.connectors ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI diagram generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
