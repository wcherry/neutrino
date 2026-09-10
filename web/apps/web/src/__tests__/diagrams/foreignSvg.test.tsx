/**
 * Opening an SVG that this editor did not write must never write to it.
 *
 * Every SVG in Drive now opens in Diagrams, and most of them are not diagrams —
 * a logo, an icon, an export from another tool. The editor has no shapes to
 * load from one, so it would open as a blank canvas; the seal-plaintext pass
 * and the autosave would then both write an *empty diagram* over the file, and
 * an SVG has no version history that says what it used to be. So the load
 * recognises the case and the editor refuses the file instead.
 *
 * This is the test that stands between that and losing someone's artwork.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const FOREIGN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30"/></svg>';

// `/diagrams/editor` is one route, so opening another diagram changes this
// value without remounting the component. `openId` is how a test moves between
// files the way a navigation does.
const { openId } = vi.hoisted(() => ({ openId: { current: 'svg-file-id' } }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'id' ? openId.current : null) }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@neutrino/ui', () => ({
  Spinner: () => React.createElement('div', { 'data-testid': 'spinner' }),
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) =>
    React.createElement('button', { onClick }, children),
  Modal: ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    open ? React.createElement('div', null, children) : null,
  ModalHeader: ({ title }: { title?: string }) => React.createElement('div', null, title),
  ModalBody: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  ModalFooter: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  useToast: () => ({ warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

// Hoisted: `vi.mock` factories run before the module body, so a plain `const`
// here would not exist yet when the factory below closes over it.
const { autosaveEncryptedContent, createDiagram, getDiagram, dek } = vi.hoisted(() => ({
  autosaveEncryptedContent: vi.fn(() => Promise.resolve({ contentVersion: 2 })),
  createDiagram: vi.fn(),
  getDiagram: vi.fn(),
  // Mutable so a test can put the editor in the state it is in before the key
  // arrives: `dekResolved` true, no key. Set `dek.current = null` for that.
  dek: { current: new Uint8Array(32) as Uint8Array | null },
}));

vi.mock('@neutrino/api-diagrams', async () => {
  // The format helpers are the real ones — recognising a foreign SVG is
  // precisely what is under test, so mocking it away would test nothing.
  const actual = await vi.importActual<typeof import('@neutrino/api-diagrams')>(
    '@neutrino/api-diagrams',
  );
  return {
    ...actual,
    diagramsApi: {
      getDiagram,
      autosaveEncryptedContent,
      createDiagram,
      saveDiagram: vi.fn(() => Promise.resolve()),
      deleteDiagram: vi.fn(() => Promise.resolve()),
    },
  };
});

vi.mock('@neutrino/auth', () => ({
  authApi: { getProfile: vi.fn(() => Promise.resolve({ name: 'Test User' })) },
  useUser: () => ({ id: 'user-1', name: 'Test User' }),
}));

// The file is stored in the clear, as an uploaded SVG is: `readStoredBody`
// tries to decrypt, fails, and falls back to reading it as plaintext — which is
// the path that sets the "seal this" flag the editor must not act on here.
vi.mock('@neutrino/e2e-crypto', () => ({
  decryptFile: vi.fn(() => {
    throw new Error('not ciphertext');
  }),
}));

vi.mock('@/lib/api', () => ({
  storageApi: {
    downloadFile: vi.fn(() =>
      Promise.resolve(new Blob([FOREIGN_SVG], { type: 'image/svg+xml' })),
    ),
  },
  encryptionApi: { setFileKey: vi.fn() },
  filesystemApi: { getFolderContents: vi.fn(() => Promise.resolve({ folders: [] })) },
  useUser: () => ({ id: 'user-1', name: 'Test User' }),
}));

vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => ({
    dekRef: dek,
    dekResolved: true,
    isNewEncryption: true,
    awaitDek: vi.fn(async () => new Uint8Array(32)),
    autosave: vi.fn(),
    createVersion: vi.fn(),
    isAutosaving: false,
    isCreatingVersion: false,
    autosaveError: null,
    createVersionError: null,
  }),
}));

vi.mock('../../app/(apps)/diagrams/editor/hooks/useDiagramCollab', () => ({
  useDiagramCollab: () => ({
    remoteUsers: [],
    isConnected: false,
    sendCursor: vi.fn(),
    broadcastDocument: vi.fn(),
  }),
}));

vi.mock('../../app/(apps)/diagrams/editor/DiagramCanvas', () => ({
  DiagramCanvas: () => React.createElement('div', { 'data-testid': 'diagram-canvas' }),
}));

vi.mock('../../app/(apps)/diagrams/editor/DiagramToolbar', () => ({
  DiagramToolbar: () => React.createElement('div', { 'data-testid': 'diagram-toolbar' }),
}));

vi.mock('../../app/(apps)/diagrams/editor/ShapePanel', () => ({
  ShapePanel: () => React.createElement('div', null),
}));

vi.mock('../../app/(apps)/diagrams/editor/PropertiesPanel', () => ({
  PropertiesPanel: () => React.createElement('div', null),
}));

vi.mock('../../app/(apps)/diagrams/editor/PagePanel', () => ({
  PagePanel: () => React.createElement('div', null),
}));

vi.mock('../../app/(apps)/diagrams/editor/collab/CommentsPanel', () => ({
  CommentsPanel: () => React.createElement('div', null),
}));

vi.mock('../../app/(apps)/diagrams/editor/data/DataPanel', () => ({
  DataPanel: () => React.createElement('div', null),
}));

vi.mock('@/components/SaveAsDialog', () => ({
  SaveAsDialog: () => React.createElement('div', null),
}));

vi.mock('../../app/(apps)/diagrams/editor/DiagramEditor.module.css', () => ({
  default: new Proxy({}, { get: (_, k) => String(k) }),
}));

import { DiagramEditor } from '../../app/(apps)/diagrams/editor/DiagramEditor';
import { diagramDocumentToSvg } from '../../app/(apps)/diagrams/editor/io/svgFormat';
import type { DiagramDocument } from '../../app/(apps)/diagrams/types';

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

/**
 * The bytes the open file holds. `vi.clearAllMocks` clears call history but not
 * implementations, so a test that changes this leaks into the next one unless
 * every setup names what it wants.
 */
async function serveBody(text: string) {
  const { storageApi } = await import('@/lib/api');
  (storageApi.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValue(
    new Blob([text], { type: 'image/svg+xml' }),
  );
}

/** Point the editor at a file of the given id and format. */
function serve(id: string, format: 'diagram' | 'svg') {
  openId.current = id;
  getDiagram.mockResolvedValue({
    id,
    title: id === 'svg-file-id' ? 'logo' : id,
    format,
    contentUrl: `/api/v1/drive/files/${id}`,
    contentWriteUrl: `/api/v1/drive/files/${id}/versions`,
    folderId: null,
    createdAt: '2026-06-08T00:00:00Z',
    updatedAt: '2026-06-08T00:00:00Z',
    contentVersion: 1,
  });
}

describe('DiagramEditor — an SVG it did not write', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    serve('svg-file-id', 'svg');
    await serveBody(FOREIGN_SVG);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the picture and refuses the file instead of opening a blank canvas', async () => {
    render(React.createElement(DiagramEditor), { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByAltText('logo')).toBeTruthy());
    // The picture, as an image — never as markup put into this origin.
    expect(screen.getByAltText('logo').getAttribute('src'))
      .toMatch(/^data:image\/svg\+xml;base64,/);
    expect(screen.queryByTestId('diagram-canvas')).toBeNull();
    expect(screen.getByText(/will not save over it/i)).toBeTruthy();
  });

  it('writes nothing to it, however long it is left open', async () => {
    vi.useFakeTimers();
    render(React.createElement(DiagramEditor), { wrapper: makeWrapper() });

    // Well past the 2 s autosave debounce, and past the seal-plaintext pass
    // that runs as soon as the load settles.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    vi.useRealTimers();

    expect(autosaveEncryptedContent).not.toHaveBeenCalled();
  });

  it('offers to build a diagram around it, leaving the original file alone', async () => {
    createDiagram.mockResolvedValue({ id: 'new-diagram', title: 'logo (Diagram)' });
    render(React.createElement(DiagramEditor), { wrapper: makeWrapper() });

    const button = await screen.findByText(/Create a diagram from this image/i);
    await act(async () => {
      button.click();
    });

    await waitFor(() => expect(createDiagram).toHaveBeenCalled());
    // A new native diagram, seeded client-side — the SVG file is untouched.
    expect(createDiagram.mock.calls[0][0]).toMatchObject({ title: 'logo (Diagram)' });
    expect(autosaveEncryptedContent).not.toHaveBeenCalled();
    const seeded = JSON.parse(
      sessionStorage.getItem('neutrino:diagram-template:new-diagram') ?? '{}',
    ) as DiagramDocument;
    expect(seeded.pages[0].shapes[0].type).toBe('drawio-image');
  });
});

describe('DiagramEditor — an SVG it did write', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serve('svg-file-id', 'svg');
  });

  it('opens on the canvas, because the diagram is inside the file', async () => {
    await serveBody(diagramDocumentToSvg({
      version: 1,
      pages: [{ id: 'p1', name: 'Page 1', shapes: [], connectors: [] }],
      viewport: { x: 0, y: 0, zoom: 1 },
    } as DiagramDocument));

    render(React.createElement(DiagramEditor), { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByTestId('diagram-canvas')).toBeTruthy());
    expect(screen.queryByText(/will not save over it/i)).toBeNull();
  });
});

/**
 * The editor reads the file once before the DEK is in hand — the hook resolves
 * `dekResolved` true with no key while auth is still loading — and that read
 * goes through the plaintext `contentUrl` branch, so what it gets back is the
 * stored *ciphertext* as text.
 *
 * Those are bytes that do not parse as a diagram. Treating that as "somebody
 * else's artwork" made every encrypted SVG diagram unopenable: the refusal
 * latched, and the later read that could actually decrypt the file arrived too
 * late to undo it. Ciphertext cannot start with `<svg`, which is what separates
 * the two.
 */
describe('DiagramEditor — an SVG it cannot read yet', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    serve('svg-file-id', 'svg');
    // No key: exactly the state of the first read, which then fetches the
    // stored bytes directly and gets ciphertext.
    dek.current = null;
  });

  afterEach(() => {
    dek.current = new Uint8Array(32);
    global.fetch = realFetch;
  });

  it('does not call undecryptable bytes a foreign SVG', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => '\u00a7ciphertext-not-markup\u00ff',
    })) as unknown as typeof fetch;

    render(React.createElement(DiagramEditor), { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByTestId('diagram-canvas')).toBeTruthy());
    expect(screen.queryByText(/will not save over it/i)).toBeNull();
  });

  /**
   * The other half of the same rule: a *plaintext* foreign SVG read on that
   * same keyless pass is still refused. Narrowing the test to `looksLikeSvg`
   * must not have narrowed away the protection it exists for.
   */
  it('still refuses a foreign SVG it can read', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => FOREIGN_SVG,
    })) as unknown as typeof fetch;

    render(React.createElement(DiagramEditor), { wrapper: makeWrapper() });

    await waitFor(() => expect(screen.getByText(/will not save over it/i)).toBeTruthy());
    expect(screen.queryByTestId('diagram-canvas')).toBeNull();
  });
});

/**
 * `/diagrams/editor` is a single route, so opening another diagram changes the
 * `id` without remounting this component. Everything the refused file left
 * behind therefore has to be cleared explicitly — and it must be, because the
 * refusal screen carries a button that navigates straight into a new diagram:
 * without the reset that diagram would open showing the *previous* file's
 * refusal and would be unable to save.
 */
describe('DiagramEditor — moving to another diagram', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    serve('svg-file-id', 'svg');
    await serveBody(FOREIGN_SVG);
  });

  it('drops the refusal when the id changes to a real diagram', async () => {
    const { rerender } = render(React.createElement(DiagramEditor), { wrapper: makeWrapper() });
    await waitFor(() => expect(screen.getByText(/will not save over it/i)).toBeTruthy());

    await serveBody(JSON.stringify({
      version: 1,
      pages: [{ id: 'p1', name: 'Page 1', shapes: [], connectors: [] }],
      viewport: { x: 0, y: 0, zoom: 1 },
    }));
    serve('native-diagram-id', 'diagram');
    await act(async () => {
      rerender(React.createElement(DiagramEditor));
    });

    await waitFor(() => expect(screen.getByTestId('diagram-canvas')).toBeTruthy());
    expect(screen.queryByText(/will not save over it/i)).toBeNull();
  });
});
