/**
 * Tests for SlideEditor's office-mode detection/fallback contract (issue #43
 * — in-place editing of MS Office docs, plan section 3).
 *
 * Mirrors the Docs test (__tests__/docs/officeMode.test.tsx): when a raw
 * .pptx file is opened at /slides/editor, `slidesApi.getSlide` 404s (there is
 * no `slides` row for it). The editor must fall back to
 * `storageApi.getFileMetadata` and, when the metadata identifies a pptx file,
 * enter "office mode" — importing the raw bytes via the existing
 * `importFromPptx` (slides/editor/pptxImport.ts, already used by the manual
 * Import action, see SlideEditor.tsx:1052) instead of showing a not-found
 * state. If the fallback ALSO 404s, a genuine not-found state renders.
 *
 * Expected to fail right now (red phase): SlideEditor has no 404 handling or
 * fallback path today, so storageApi.getFileMetadata is never called and
 * importFromPptx is never invoked for a missing `slides` row.
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
  ColorPickerPopover: () => null,
  ZoomSlider: () => null,
  ShareButton: () => null,
  useToast: () => ({ warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('@neutrino/auth', () => ({
  useUser: () => null,
  useAuth: () => ({ user: null, isLoading: false }),
}));

const mockGetSlide = vi.fn();
const mockGetFileMetadata = vi.fn();
const mockDownloadFile = vi.fn();

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
    getSlide: (...args: unknown[]) => mockGetSlide(...args),
    listThemes: vi.fn(() => Promise.resolve([])),
    autosaveEncryptedContent: vi.fn(() => Promise.resolve()),
    saveSlide: vi.fn(() => Promise.resolve()),
  },
  driveReadContent: vi.fn(() => Promise.resolve('')),
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
  }),
}));

vi.mock('@neutrino/e2e-crypto', () => ({ decryptFile: vi.fn() }));

vi.mock('@/hooks/useSpellCheck', () => ({ useSpellCheck: () => ({ spellCheck: false }) }));

vi.mock('@/providers/FeatureFlagsProvider', () => ({
  useFeatureFlags: () => ({ slidesVideoEmbeds: false, officeInPlaceEditing: true }),
}));

vi.mock('@neutrino/sheet-embed', () => ({
  useSheetPasteInterceptor: () => ({ handlePaste: vi.fn(), dialogState: null }),
  PasteChoiceDialog: () => null,
}));

vi.mock('../../app/(apps)/slides/editor/InsertSheetDialog', () => ({ InsertSheetDialog: () => null }));
vi.mock('../../app/(apps)/slides/editor/InsertImageDialog', () => ({ InsertImageDialog: () => null }));
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

  it('falls back to storageApi.getFileMetadata when slidesApi.getSlide 404s', async () => {
    mockGetSlide.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Presentation not found'));
    mockGetFileMetadata.mockResolvedValue({ id: 'test-slide-id', name: 'deck.pptx', mimeType: PPTX_MIME });
    mockDownloadFile.mockResolvedValue(new Blob(['fake pptx bytes']));

    renderSlideEditor();

    await waitFor(() => expect(mockGetFileMetadata).toHaveBeenCalledWith('test-slide-id'));
  });

  it('enters office mode and imports via importFromPptx for a raw .pptx file', async () => {
    mockGetSlide.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Presentation not found'));
    mockGetFileMetadata.mockResolvedValue({ id: 'test-slide-id', name: 'deck.pptx', mimeType: PPTX_MIME });
    mockDownloadFile.mockResolvedValue(new Blob(['fake pptx bytes']));

    renderSlideEditor();

    await waitFor(() => expect(mockImportFromPptx).toHaveBeenCalled(), { timeout: 3000 });
    expect(screen.queryByText(/presentation not found/i)).not.toBeInTheDocument();
  });

  it('shows a genuine not-found state when the storage fallback ALSO 404s', async () => {
    mockGetSlide.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Presentation not found'));
    mockGetFileMetadata.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'File not found'));

    renderSlideEditor();

    await waitFor(
      () => expect(screen.getByText(/presentation not found/i)).toBeInTheDocument(),
      { timeout: 3000 }
    );
    expect(mockImportFromPptx).not.toHaveBeenCalled();
  });

  it('does NOT enter office mode for a fallback file that is not an office format', async () => {
    mockGetSlide.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Presentation not found'));
    mockGetFileMetadata.mockResolvedValue({ id: 'test-slide-id', name: 'photo.png', mimeType: 'image/png' });

    renderSlideEditor();

    await waitFor(() => expect(mockGetFileMetadata).toHaveBeenCalled());
    expect(mockImportFromPptx).not.toHaveBeenCalled();
  });
});
