/**
 * Tests that opening a `.pptx` at /slides/editor loads it: the editor
 * identifies the file through `storageApi.getFileMetadata`, and when the
 * metadata says pptx it downloads and parses the package rather than showing
 * the empty default deck.
 *
 * This used to describe a fallback — `slidesApi.getSlide` was asked first and
 * its 404 meant "not bespoke JSON, therefore OOXML". No deck was ever stored
 * in that format and it is gone, so there is one path and no probe.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// All vi.mock() calls before the module under test is imported.
// ---------------------------------------------------------------------------

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'id' ? 'test-slide-id' : null) }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@neutrino/ui', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) =>
    React.createElement('button', { onClick }, children),
  Toolbar: () => null,
  ToolbarGroup: () => null,
  ToolbarDivider: () => null,
  ToolbarButton: () => null,
  ToolbarSelect: () => null,
  FontSizeInput: () => null,
  ColorPickerPopover: () => null,
  ZoomSlider: () => null,
  ShareButton: () => null,
  HamburgerMenu: () => null,
  Modal: () => null,
  ModalHeader: () => null,
  ModalBody: () => null,
  useToast: () => ({ warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('@neutrino/auth', () => ({
  // The editor is only reachable signed in, and the content load waits for a
  // real user — `dekResolved` alone goes true before auth has arrived.
  useUser: () => ({ id: 'user-1', name: 'Tester' }),
  useAuth: () => ({ user: null, isLoading: false }),
}));

const mockGetFileMetadata = vi.fn();
const mockDownloadFile = vi.fn();
// The office-mode read goes through `driveReadBytes` — see its module comment.
const mockReadBytes = vi.fn();

/**
 * Stand-in for stored `.pptx` bytes.
 *
 * The zip local-file-header magic is the load-bearing part: these tests hold no
 * key, and the load tells "an unencrypted package" from "ciphertext it cannot
 * open" by that magic. Bytes without it are the latter, and are left alone
 * rather than handed to the importer — so a body that only *claims* to be a
 * deck would assert the opposite of what these tests are about.
 */
function fakePptxBytes(): Uint8Array {
  return new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode('fake pptx bytes')]);
}

vi.mock('@/lib/api', () => ({
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
  slidesApi: {
    listThemes: vi.fn(() => Promise.resolve([])),
    autosaveEncryptedContent: vi.fn(() => Promise.resolve()),
    saveSlide: vi.fn(() => Promise.resolve()),
  },
  driveReadContent: vi.fn(() => Promise.resolve('')),
  driveReadBytes: (...args: unknown[]) => mockReadBytes(...args),
  driveAutosaveEncryptedContent: vi.fn(() => Promise.resolve()),
  storageApi: {
    getFileMetadata: (...args: unknown[]) => mockGetFileMetadata(...args),
    downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
  },
}));

vi.mock('@/app/(apps)/drive/ShareDialog', () => ({ ShareDialog: () => null }));

vi.mock('@/hooks/useSlidePresence', () => ({
  useSlidePresence: () => ({ remoteUsers: [], broadcastPresentation: vi.fn() }),
}));

/**
 * What the key hook reports. Mutable so a test can walk it through the
 * sequence a page reload produces: resolved with no key while the keyring is
 * still being restored, then unresolved, then resolved with the key.
 */
const encState = {
  dekRef: { current: null as Uint8Array | null },
  dekResolved: true,
  isNewEncryption: false,
  awaitDek: async () => encState.dekRef.current,
};

vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => encState,
}));

const mockDecryptFile = vi.fn();
vi.mock('@neutrino/e2e-crypto', () => ({
  decryptFile: (...args: unknown[]) => mockDecryptFile(...args),
  isUnlocked: () => true,
}));

vi.mock('@/hooks/useSpellCheck', () => ({ useSpellCheck: () => ({ spellCheck: false }) }));

vi.mock('@neutrino/sheet-embed', () => ({
  useSheetPasteInterceptor: () => ({ handlePaste: vi.fn(), dialogState: null }),
  PasteChoiceDialog: () => null,
}));

vi.mock('../../app/(apps)/slides/editor/InsertSheetDialog', () => ({ InsertSheetDialog: () => null }));
vi.mock('@/components/InsertImageDialog', () => ({ InsertImageDialog: () => null }));
vi.mock('../../app/(apps)/slides/editor/InsertDiagramDialog', () => ({ InsertDiagramDialog: () => null }));

// pptxImport is dynamically imported (`await import('./pptxImport')`) by the
// existing manual-Import path — office mode is expected to reuse it.
const mockImportFromPptx = vi.fn(() =>
  Promise.resolve({
    slides: [{ id: 's1', background: { type: 'color', value: '#fff' }, elements: [], notes: '', transition: 'fade' }],
    theme: { name: 'default', primaryColor: '#000', backgroundColor: '#fff', textColor: '#000', accentColor: '#000', fontFamily: 'Inter', defaultTransition: 'fade' },
  })
);
vi.mock('../../app/(apps)/slides/editor/pptxImport', () => ({
  importFromPptx: (...args: unknown[]) => mockImportFromPptx(...args),
}));

vi.mock('../../app/(apps)/slides/editor/page.module.css', () => ({
  default: new Proxy({}, { get: (_, k) => String(k) }),
}));

// ---------------------------------------------------------------------------
// Module imports — after all vi.mock() calls
// ---------------------------------------------------------------------------

import { SlideEditor } from '../../app/(apps)/slides/editor/SlideEditor';
import { ApiClientError } from '@/lib/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
}

function renderSlideEditor() {
  const qc = makeQueryClient();
  return render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(SlideEditor))
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SlideEditor — office-mode detection/fallback (issue #43)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    encState.dekRef = { current: null };
    encState.dekResolved = true;
  });

  it('identifies the presentation through storageApi.getFileMetadata', async () => {
    mockGetFileMetadata.mockResolvedValue({ id: 'test-slide-id', name: 'deck.pptx', mimeType: PPTX_MIME });
    mockReadBytes.mockResolvedValue(fakePptxBytes());

    renderSlideEditor();

    await waitFor(() => expect(mockGetFileMetadata).toHaveBeenCalledWith('test-slide-id'));
  });

  it('enters office mode and imports via importFromPptx for a raw .pptx file', async () => {
    mockGetFileMetadata.mockResolvedValue({ id: 'test-slide-id', name: 'deck.pptx', mimeType: PPTX_MIME });
    mockReadBytes.mockResolvedValue(fakePptxBytes());

    renderSlideEditor();

    await waitFor(() => expect(mockImportFromPptx).toHaveBeenCalled(), { timeout: 3000 });
    expect(screen.queryByText(/presentation not found/i)).not.toBeInTheDocument();
  });

  it('shows a genuine not-found state when the storage fallback ALSO 404s', async () => {
    mockGetFileMetadata.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'File not found'));

    renderSlideEditor();

    await waitFor(
      () => expect(screen.getByText(/presentation not found/i)).toBeInTheDocument(),
      { timeout: 3000 }
    );
    expect(mockImportFromPptx).not.toHaveBeenCalled();
  });

  it('does NOT enter office mode for a fallback file that is not an office format', async () => {
    mockGetFileMetadata.mockResolvedValue({ id: 'test-slide-id', name: 'photo.png', mimeType: 'image/png' });

    renderSlideEditor();

    await waitFor(() => expect(mockGetFileMetadata).toHaveBeenCalled());
    expect(mockImportFromPptx).not.toHaveBeenCalled();
  });

  /**
   * After a full page load the keyring is restored asynchronously, and until it
   * is the key hook reports "resolved" with no key, then resolves for real. The
   * load used to read on that first signal, fail to parse the ciphertext, and —
   * being one-shot — never read again: a reopened deck showed the default
   * presentation, and the next edit saved that over the real one.
   */
  it('reads an encrypted deck again once its key resolves, rather than giving up on the first try', async () => {
    mockGetFileMetadata.mockResolvedValue({ id: 'test-slide-id', name: 'deck.pptx', mimeType: PPTX_MIME });
    // Ciphertext: no zip magic, so it cannot be mistaken for a plaintext package.
    mockReadBytes.mockResolvedValue(new Uint8Array([0x9a, 0x01, 0x02, 0x03, 0x04]));
    mockDecryptFile.mockReturnValue(fakePptxBytes());

    const view = renderSlideEditor();
    await waitFor(() => expect(mockReadBytes).toHaveBeenCalledTimes(1));
    expect(mockImportFromPptx).not.toHaveBeenCalled();

    // The keyring arrives: the hook re-resolves, and this time holds the key.
    encState.dekResolved = false;
    view.rerender(React.createElement(QueryClientProvider, { client: makeQueryClient() }, React.createElement(SlideEditor)));
    encState.dekRef = { current: new Uint8Array(32) };
    encState.dekResolved = true;
    view.rerender(React.createElement(QueryClientProvider, { client: makeQueryClient() }, React.createElement(SlideEditor)));

    await waitFor(() => expect(mockImportFromPptx).toHaveBeenCalled(), { timeout: 3000 });
    expect(mockReadBytes).toHaveBeenCalledTimes(2);
    expect(mockDecryptFile).toHaveBeenCalled();
  });

  /**
   * The same reload, caught mid-read: the key hook's re-resolution changes the
   * load effect's dependencies while the first read is still in flight, and
   * the cleanup cancels it. A cancelled load must be allowed to run again — it
   * used to leave the one-shot flag set, and a plaintext `.pptx` opened as the
   * default deck with nothing ever reading it.
   */
  it('reads the deck again when the first read is cancelled by the key resolving', async () => {
    mockGetFileMetadata.mockResolvedValue({ id: 'test-slide-id', name: 'deck.pptx', mimeType: PPTX_MIME });
    let releaseFirst: (bytes: Uint8Array) => void = () => {};
    mockReadBytes
      .mockImplementationOnce(() => new Promise<Uint8Array>((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValue(fakePptxBytes());

    const view = renderSlideEditor();
    await waitFor(() => expect(mockReadBytes).toHaveBeenCalledTimes(1));

    const rerender = () =>
      view.rerender(React.createElement(QueryClientProvider, { client: makeQueryClient() }, React.createElement(SlideEditor)));
    encState.dekResolved = false;
    rerender();
    encState.dekRef = { current: new Uint8Array(32) };
    encState.dekResolved = true;
    rerender();

    // The first read lands after it was cancelled, and must change nothing.
    releaseFirst(fakePptxBytes());

    await waitFor(() => expect(mockReadBytes).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockImportFromPptx).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
});

