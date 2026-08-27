/**
 * Tests for AI diagram generation — the client call and the two steps between the model's
 * answer and what lands on the page.
 *
 * The panel used to POST to `/api/ai/diagram-generate`, a Next.js route handler that exists only
 * in `next dev` — production is a static export served by the Rust binary, which answered the POST
 * with 405 (issue #139). The endpoint is now `/api/v1/diagrams/ai/generate` and goes through the
 * API client, which is what attaches the session token and the AI credentials.
 *
 * The other half is that generated shapes are re-identified on insert: a connector names its ends
 * by the id the model gave them, so unless the rewrite is applied to both, every connector lands
 * unattached.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@neutrino/api-core', () => ({
  request: vi.fn(),
  contentVersionQuery: () => '',
  // The credentials the client attaches; what they contain is pinned in aiCredentials.test.ts.
  aiCredentials: () => ({ provider: 'gemini', apiKey: '' }),
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, code: string, message: string) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

import { renderHook, act } from '@testing-library/react';
import { request } from '@neutrino/api-core';
import { diagramsAI } from '../../app/(apps)/diagrams/api';
import { parseAiDiagramResponse } from '../../app/(apps)/diagrams/editor/ai/aiDiagramUtils';
import { useDiagramEditor } from '../../app/(apps)/diagrams/editor/hooks/useDiagramEditor';
import type { DiagramDocument } from '../../app/(apps)/diagrams/types';

const mockRequest = request as ReturnType<typeof vi.fn>;

const emptyDocument: DiagramDocument = {
  version: 1,
  pages: [{ id: 'page-1', name: 'Page 1', shapes: [], connectors: [] }],
  viewport: { x: 0, y: 0, zoom: 1 },
};

describe('diagramsAI.generate', () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  it('posts the prompt to the versioned AI endpoint', async () => {
    mockRequest.mockResolvedValue({ shapes: [], connectors: [] });

    await diagramsAI.generate('A CI/CD pipeline');

    expect(mockRequest).toHaveBeenCalledWith('/api/v1/diagrams/ai/generate', {
      method: 'POST',
      body: JSON.stringify({ provider: 'gemini', apiKey: '', prompt: 'A CI/CD pipeline' }),
    });
  });
});

describe('parseAiDiagramResponse', () => {
  it('fills in styling and defaults the server does not send', () => {
    const { shapes, connectors } = parseAiDiagramResponse({
      shapes: [{ id: 'a', type: 'flowchart-process', x: 10, y: 20, width: 120, height: 60, label: 'Build' }],
      connectors: [{ sourceId: 'a', targetId: 'a', type: 'orthogonal', label: 'retry' }],
    });

    expect(shapes[0].style.fill).toBeDefined();
    expect(shapes[0].label).toBe('Build');
    expect(connectors[0].style.stroke).toBeDefined();
    expect(connectors[0].waypoints).toEqual([]);
  });

  it('leaves a connector unattached when the shape it names is missing', () => {
    const { connectors } = parseAiDiagramResponse({
      shapes: [{ id: 'a' }],
      connectors: [{ sourceId: 'a', targetId: 'ghost' }],
    });

    expect(connectors[0].sourceId).toBe('a');
    expect(connectors[0].targetId).toBeNull();
  });
});

describe('useDiagramEditor.insertElements', () => {
  it('re-points connectors at the rewritten shape ids', () => {
    const { result } = renderHook(() => useDiagramEditor(emptyDocument));
    const { shapes, connectors } = parseAiDiagramResponse({
      shapes: [{ id: 'a', label: 'Start' }, { id: 'b', label: 'End' }],
      connectors: [{ sourceId: 'a', targetId: 'b' }],
    });

    act(() => result.current.insertElements(shapes, connectors));

    const page = result.current.document.pages[0];
    expect(page.shapes).toHaveLength(2);
    expect(page.connectors).toHaveLength(1);
    // Ids are regenerated on insert, so the connector has to follow them.
    expect(page.shapes.map((s) => s.id)).not.toContain('a');
    expect(page.connectors[0].sourceId).toBe(page.shapes[0].id);
    expect(page.connectors[0].targetId).toBe(page.shapes[1].id);
  });

  it('inserts the whole diagram as one undo step', () => {
    const { result } = renderHook(() => useDiagramEditor(emptyDocument));
    const { shapes, connectors } = parseAiDiagramResponse({
      shapes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      connectors: [{ sourceId: 'a', targetId: 'b' }, { sourceId: 'b', targetId: 'c' }],
    });

    act(() => result.current.insertElements(shapes, connectors));
    act(() => result.current.undo());

    const page = result.current.document.pages[0];
    expect(page.shapes).toHaveLength(0);
    expect(page.connectors).toHaveLength(0);
  });

  it('drops a connector whose ends did not come with it', () => {
    const { result } = renderHook(() => useDiagramEditor(emptyDocument));
    const { shapes, connectors } = parseAiDiagramResponse({
      shapes: [{ id: 'a' }],
      connectors: [{ sourceId: 'a', targetId: 'ghost' }],
    });

    act(() => result.current.insertElements(shapes, connectors));

    expect(result.current.document.pages[0].connectors).toHaveLength(0);
  });
});
