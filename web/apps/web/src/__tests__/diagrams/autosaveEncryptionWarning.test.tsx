/**
 * Tests that DiagramEditor shows a toast with a settings help link
 * when the autosave fires but the encryption key (DEK) is unavailable.
 *
 * The autosave schedules itself 2000 ms after render when editor.canUndo is
 * true. We use fake timers to advance past that deadline.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// All vi.mock() calls must be declared before any imports of the module under
// test so that Vitest's hoisting can process them correctly.
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'id' ? 'test-diagram-id' : null) }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

const mockWarning = vi.fn();

vi.mock('@neutrino/ui', () => ({
  Spinner: () => React.createElement('div', { 'data-testid': 'spinner' }),
  useToast: () => ({
    warning: mockWarning,
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@neutrino/api-drawing', () => ({
  diagramsApi: {
    getDiagram: vi.fn(() =>
      Promise.resolve({
        id: 'test-diagram-id',
        title: 'Test',
        contentUrl: null,
        contentWriteUrl: null,
        folderId: null,
        createdAt: '',
        updatedAt: '',
      })
    ),
    autosaveEncryptedContent: vi.fn(() => Promise.resolve()),
    autosaveContent: vi.fn(() => Promise.resolve()),
    saveDiagram: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@neutrino/auth', () => ({
  authApi: {
    getProfile: vi.fn(() => Promise.resolve({ name: 'Test User' })),
  },
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  decryptFile: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  storageApi: {
    downloadFile: vi.fn(() => Promise.resolve(new Blob())),
  },
}));

// No-DEK mock: dekRef.current === null, dekResolved === true
vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => ({
    dekRef: { current: null },
    dekResolved: true,
    autosave: vi.fn(),
    createVersion: vi.fn(),
    isAutosaving: false,
    isCreatingVersion: false,
    autosaveError: null,
    createVersionError: null,
  }),
}));

vi.mock('@/providers/FeatureFlagsProvider', () => ({
  useFeatureFlags: () => ({ diagramsApp: true }),
}));

vi.mock('../../app/(apps)/diagrams/editor/hooks/useDiagramEditor', () => ({
  useDiagramEditor: () => ({
    document: {
      version: 1,
      pages: [
        {
          id: 'page-1',
          name: 'Page 1',
          shapes: [],
          connectors: [],
          gridEnabled: true,
          gridSize: 20,
          snapEnabled: true,
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    canUndo: true,
    canRedo: false,
    activePageIndex: 0,
    setDocument: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    reset: vi.fn(),
    addShape: vi.fn(() => 'shape-new'),
    updateShape: vi.fn(),
    deleteShapes: vi.fn(),
    removeShapes: vi.fn(),
    duplicateShapes: vi.fn(() => []),
    addConnector: vi.fn(),
    updateConnector: vi.fn(),
    deleteConnectors: vi.fn(),
    removeConnectors: vi.fn(),
    addPage: vi.fn(),
    deletePage: vi.fn(),
    removePage: vi.fn(),
    renamePage: vi.fn(),
    movePage: vi.fn(),
    setActivePage: vi.fn(),
    setViewport: vi.fn(),
    addStroke: vi.fn(),
    deleteStrokes: vi.fn(),
    removeStrokes: vi.fn(),
    applyLayout: vi.fn(),
    runLayout: vi.fn(),
    align: vi.fn(),
    distribute: vi.fn(),
    bringForward: vi.fn(),
    sendBackward: vi.fn(),
    bringToFront: vi.fn(),
    sendToBack: vi.fn(),
    importData: vi.fn(),
    updateDataBinding: vi.fn(),
    updateConditionalRules: vi.fn(),
  }),
}));

vi.mock('../../app/(apps)/diagrams/editor/hooks/useDiagramCollab', () => ({
  useDiagramCollab: () => ({
    remoteUsers: [],
    isConnected: false,
    sendCursor: vi.fn(),
    sendCursorMove: vi.fn(),
    sendSelectionChange: vi.fn(),
    sendPresence: vi.fn(),
  }),
}));

vi.mock('../../app/(apps)/diagrams/editor/DiagramCanvas', () => ({
  DiagramCanvas: () => React.createElement('div', { 'data-testid': 'diagram-canvas' }),
}));

vi.mock('../../app/(apps)/diagrams/editor/DiagramToolbar', () => ({
  DiagramToolbar: () => React.createElement('div', { 'data-testid': 'diagram-toolbar' }),
}));

vi.mock('../../app/(apps)/diagrams/editor/ShapePanel', () => ({
  ShapePanel: () => React.createElement('div', { 'data-testid': 'shape-panel' }),
}));

vi.mock('../../app/(apps)/diagrams/editor/PropertiesPanel', () => ({
  PropertiesPanel: () => React.createElement('div', { 'data-testid': 'properties-panel' }),
}));

vi.mock('../../app/(apps)/diagrams/editor/PagePanel', () => ({
  PagePanel: () => React.createElement('div', { 'data-testid': 'page-panel' }),
}));

vi.mock('../../app/(apps)/diagrams/editor/collab/CommentsPanel', () => ({
  CommentsPanel: () => React.createElement('div', { 'data-testid': 'comments-panel' }),
}));

vi.mock('../../app/(apps)/diagrams/editor/collab/PresenceBar', () => ({
  PresenceBar: () => React.createElement('div', { 'data-testid': 'presence-bar' }),
}));

vi.mock('../../app/(apps)/diagrams/editor/data/DataPanel', () => ({
  DataPanel: () => React.createElement('div', { 'data-testid': 'data-panel' }),
}));

vi.mock('../../app/(apps)/diagrams/editor/DiagramEditor.module.css', () => ({
  default: new Proxy({}, { get: (_, k) => String(k) }),
}));

vi.mock('../../app/(apps)/diagrams/editor/shapes/ShapeLibrary', () => ({
  DEFAULT_SHAPES: [],
  SHAPE_LIBRARY: [],
}));

// ---------------------------------------------------------------------------
// Module import — after all vi.mock() calls
// ---------------------------------------------------------------------------

import { DiagramEditor } from '../../app/(apps)/diagrams/editor/DiagramEditor';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiagramEditor — encryption warning toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a toast warning with a help link when DEK is unavailable', async () => {
    const wrapper = makeWrapper();
    vi.useFakeTimers();

    render(React.createElement(DiagramEditor), { wrapper });

    // Advance past the 2000 ms autosave debounce using the async variant so
    // that Promise microtasks flush between timer callbacks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    // At this point the saveMutation.mutate() call has fired synchronously
    // (the mutationFn throws 'no-dek' synchronously since dekRef.current is
    // null, so onError runs before the next tick).
    // Switch back to real timers before asserting so that any remaining
    // internal React / TanStack Query microtasks can settle.
    vi.useRealTimers();

    await waitFor(() => expect(mockWarning).toHaveBeenCalled(), { timeout: 3000 });

    // The message passed to toast.warning must be a React node containing a
    // link pointing at the encryption settings page.
    const message = mockWarning.mock.calls[0][0] as React.ReactNode;
    const { getByRole } = render(React.createElement(React.Fragment, null, message));
    expect(getByRole('link')).toHaveAttribute('href', '/settings?tab=advanced');
  });
});
