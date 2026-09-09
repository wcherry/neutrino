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
  useUser: () => null,
  useAuth: () => ({ user: null, isLoading: false }),
}));

const mockGetFileMetadata = vi.fn();
const mockDownloadFile = vi.fn();
// The office-mode read goes through `driveReadBytes` — see its module comment.
const mockReadBytes = vi.fn();

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

vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => ({
    dekRef: { current: null },
    dekResolved: true,
    isNewEncryption: false,
    awaitDek: async () => null,
  }),
}));

vi.mock('@neutrino/e2e-crypto', () => ({ decryptFile: vi.fn(), isUnlocked: () => true }));

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
  });

  it('identifies the presentation through storageApi.getFileMetadata', async () => {
    mockGetFileMetadata.mockResolvedValue({ id: 'test-slide-id', name: 'deck.pptx', mimeType: PPTX_MIME });
    mockReadBytes.mockResolvedValue(new TextEncoder().encode('fake pptx bytes'));

    renderSlideEditor();

    await waitFor(() => expect(mockGetFileMetadata).toHaveBeenCalledWith('test-slide-id'));
  });

  it('enters office mode and imports via importFromPptx for a raw .pptx file', async () => {
    mockGetFileMetadata.mockResolvedValue({ id: 'test-slide-id', name: 'deck.pptx', mimeType: PPTX_MIME });
    mockReadBytes.mockResolvedValue(new TextEncoder().encode('fake pptx bytes'));

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
});
