/**
 * Tests for DocEditor's office-mode detection/fallback contract (issue #43 —
 * in-place editing of MS Office docs, plan section 3).
 *
 * This is the riskiest, most novel piece of frontend logic in the feature:
 * when a raw .docx file is opened in the Docs editor route, `docsApi.getDoc`
 * 404s (there is no `docs` row for it — it's not a native Neutrino doc). The
 * editor must distinguish that case from a genuinely deleted/missing file by
 * falling back to `storageApi.getFileMetadata`:
 *   - If the fallback metadata identifies an office format (docx mimetype or
 *     .docx extension), the editor enters "office mode": it downloads the raw
 *     file bytes and renders them via mammoth's HTML conversion instead of
 *     showing a not-found state.
 *   - If the fallback ALSO 404s, a genuine not-found state renders.
 *
 * Per the plan's guidance we keep this focused on the detection/fallback
 * contract rather than exercising the full 2000+-line DocEditor end-to-end;
 * however, since no standalone "office mode" module is named in the plan for
 * Docs (unlike officeFormats.ts/routeForFile.ts/useOfficeFileMode.ts), the
 * only way to pin down this *contract* is to render the real DocEditor with
 * every dependency mocked (API layer, tiptap, extensions) and observe the
 * fallback wiring — mirroring the mocking approach already used for DocEditor
 * in autosaveEncryptionWarning.test.tsx.
 *
 * Expected to fail right now (red phase): DocEditor has no 404 handling or
 * fallback path at all today, so `storageApi.getFileMetadata` is never
 * called, and mammoth's `convertToHtml` is never invoked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// All vi.mock() calls before the module under test is imported.
// ---------------------------------------------------------------------------

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'id' ? 'test-doc-id' : null) }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@neutrino/ui', () => ({
  Spinner: ({ overlay }: { overlay?: boolean }) =>
    React.createElement('div', { 'data-testid': 'spinner', 'data-overlay': overlay }),
  useToast: () => ({ warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }),
  ShareButton: () => null,
  ZoomSlider: () => null,
}));

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
  useFeatureFlags: () => ({
    docsLayoutStructure: false,
    docsAdvancedFormatting: false,
    docsEditingTools: false,
    docsPresence: false,
    docsTrackChanges: false,
    docsCompare: false,
    docsDistractionFree: false,
    sheetLiveEmbed: false,
    colorPickerAlpha: false,
    officeInPlaceEditing: true,
  }),
}));

// ---------------------------------------------------------------------------
// The API mock is declared with `let` handles so each test can reconfigure
// getDoc / getFileMetadata behavior per-scenario.
// ---------------------------------------------------------------------------

const mockGetDoc = vi.fn();
const mockGetFileMetadata = vi.fn();
const mockDownloadFile = vi.fn();

vi.mock('@/lib/api', () => ({
  // Declared inline (not referencing an outer-scope variable) so it is safe
  // under Vitest's vi.mock hoisting to the top of the file.
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
  docsApi: {
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
    autosaveEncryptedContent: vi.fn(() => Promise.resolve()),
    saveDoc: vi.fn(() => Promise.resolve()),
    exportText: vi.fn(() => Promise.resolve({ text: '' })),
  },
  driveReadContent: vi.fn(() => Promise.resolve('')),
  driveCreateVersion: vi.fn(() => Promise.resolve()),
  driveCreateEncryptedVersion: vi.fn(() => Promise.resolve()),
  driveAutosaveEncryptedContent: vi.fn(() => Promise.resolve()),
  storageApi: {
    getFileMetadata: (...args: unknown[]) => mockGetFileMetadata(...args),
    downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
    uploadFile: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  decryptFile: vi.fn(),
}));

vi.mock('@/hooks/useSpellCheck', () => ({ useSpellCheck: () => ({ spellCheck: false }) }));
vi.mock('@/hooks/useNspell', () => ({ useNspell: () => null }));
vi.mock('@/hooks/useAiSettings', () => ({
  useAiSettings: () => ({ getProviderOptions: () => ({ provider: 'openai', apiKey: '' }) }),
}));
vi.mock('@/hooks/usePresence', () => ({
  usePresence: () => ({ remoteUsers: [], isConnected: false, syncReady: false, isLocalWriter: true }),
}));

vi.mock('@neutrino/auth', () => ({
  authApi: { getProfile: vi.fn(() => Promise.resolve({ name: 'Test' })) },
  useAuth: () => ({ user: null, isLoading: false }),
  useUser: () => null,
}));

vi.mock('@neutrino/sheet-embed', () => ({
  useSheetPasteInterceptor: () => ({ handlePaste: vi.fn(), dialogState: null }),
  PasteChoiceDialog: () => null,
}));

// mammoth is dynamically imported (`await import('mammoth')`) by the existing
// manual-Import path — office mode is expected to reuse the same conversion.
const mockConvertToHtml = vi.fn(() => Promise.resolve({ value: '<p>Hello from docx</p>' }));
vi.mock('mammoth', () => ({
  convertToHtml: (...args: unknown[]) => mockConvertToHtml(...args),
}));

vi.mock('@tiptap/react', () => ({
  useEditor: () => null,
  EditorContent: () => React.createElement('div', { 'data-testid': 'editor-content' }),
}));

vi.mock('next/dynamic', () => ({ default: () => () => null }));

vi.mock('../../app/(apps)/docs/editor/Toolbar', () => ({ Toolbar: () => null }));
vi.mock('../../app/(apps)/docs/editor/MenuBar', () => ({ HamburgerMenu: () => null }));
vi.mock('../../app/(apps)/docs/editor/DocOutline', () => ({ DocOutline: () => null }));
vi.mock('../../app/(apps)/docs/editor/HeaderFooterModal', () => ({ HeaderFooterModal: () => null }));
vi.mock('../../app/(apps)/docs/editor/WatermarkModal', () => ({ WatermarkModal: () => null }));
vi.mock('../../app/(apps)/docs/editor/ThemeModal', () => ({ ThemeModal: () => null }));
vi.mock('../../app/(apps)/docs/editor/ParagraphStylesModal', () => ({ ParagraphStylesModal: () => null }));
vi.mock('../../app/(apps)/docs/editor/ImagePropertiesModal', () => ({ ImagePropertiesModal: () => null }));
vi.mock('../../app/(apps)/docs/editor/TableCellModal', () => ({ TableCellModal: () => null }));
vi.mock('../../app/(apps)/docs/editor/EditorContextMenu', () => ({ EditorContextMenu: () => null }));
vi.mock('../../app/(apps)/docs/editor/FindReplaceBar', () => ({ FindReplaceBar: () => null }));
vi.mock('../../app/(apps)/docs/editor/AiPanel', () => ({ AiPanel: () => null }));
vi.mock('../../app/(apps)/docs/editor/ChangeToneDialog', () => ({ ChangeToneDialog: () => null }));
vi.mock('../../app/(apps)/docs/editor/PresenceBar', () => ({ PresenceBar: () => null }));
vi.mock('../../app/(apps)/docs/editor/TrackChangesBar', () => ({ TrackChangesBar: () => null }));
vi.mock('../../app/(apps)/docs/editor/DocComparePanel', () => ({ DocComparePanel: () => null }));
vi.mock('@/components/VersionHistoryPanel', () => ({ VersionHistoryPanel: () => null }));
vi.mock('@/components/CommentsPanel', () => ({ CommentsPanel: () => null }));
vi.mock('@/components/SaveAsDialog', () => ({ SaveAsDialog: () => null }));
vi.mock('@/app/(apps)/drive/ShareDialog', () => ({ ShareDialog: () => null }));
vi.mock('./InsertDiagramDialog', () => ({ InsertDiagramDialog: () => null }));
vi.mock('../../app/(apps)/docs/editor/InsertDiagramDialog', () => ({ InsertDiagramDialog: () => null }));

vi.mock('@/lib/SheetEmbedExtension', () => ({ SheetEmbedExtension: {} }));
vi.mock('@/lib/extensions/DiagramEmbedExtension', () => ({ DiagramEmbedExtension: {} }));
vi.mock('@/lib/extensions/FootnoteExtension', () => ({
  FootnoteExtension: {},
  getFootnoteItems: () => [],
  FootnoteRegistry: { set: vi.fn() },
}));
vi.mock('@/lib/extensions/CrossRefExtension', () => ({ CrossRefExtension: {} }));
vi.mock('@/lib/extensions/TableOfContentsExtension', () => ({ TableOfContentsExtension: {} }));
vi.mock('@/lib/extensions/SectionBreakExtension', () => ({ SectionBreakExtension: {} }));
vi.mock('@/lib/extensions/ColumnLayoutExtension', () => ({ ColumnLayoutExtension: {} }));
vi.mock('@/lib/extensions/SubSuperExtension', () => ({ Superscript: {}, Subscript: {} }));
vi.mock('@/lib/extensions/IndentExtension', () => ({ IndentExtension: {} }));
vi.mock('@/lib/extensions/ListStyleExtension', () => ({ ListStyleExtension: {} }));
vi.mock('@/lib/extensions/AdvancedTableCellExtension', () => ({ AdvancedTableCell: {} }));
vi.mock('@/lib/extensions/AdvancedImageExtension', () => ({ AdvancedImage: { configure: () => ({}) } }));
vi.mock('@/lib/extensions/FindReplaceExtension', () => ({ FindReplaceExtension: {} }));
vi.mock('@/lib/extensions/GrammarCheckExtension', () => ({
  GrammarCheckExtension: {},
  getGrammarIssueAt: () => null,
}));
vi.mock('@/lib/extensions/SpellCheckExtension', () => ({ SpellCheckExtension: {} }));
vi.mock('@/lib/extensions/RemoteCursorsExtension', () => ({ RemoteCursorsExtension: {} }));
vi.mock('@/lib/extensions/TrackChangesExtension', () => ({
  TrackChangesExtension: {},
  isSuggestingMode: () => false,
}));
vi.mock('@tiptap/starter-kit', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-paragraph', () => ({ default: { extend: () => ({ addAttributes: () => ({}) }) } }));
vi.mock('@tiptap/extension-underline', () => ({ default: {} }));
vi.mock('@tiptap/extension-text-style', () => ({ default: {} }));
vi.mock('@tiptap/extension-color', () => ({ Color: {} }));
vi.mock('@tiptap/extension-font-family', () => ({ default: {} }));
vi.mock('@tiptap/extension-text-align', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-table', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-table-row', () => ({ default: {} }));
vi.mock('@tiptap/extension-table-cell', () => ({ default: {} }));
vi.mock('@tiptap/extension-table-header', () => ({ default: {} }));
vi.mock('@tiptap/extension-image', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-link', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-placeholder', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-character-count', () => ({ default: {} }));
vi.mock('@tiptap/extension-highlight', () => ({ default: { configure: () => ({}) } }));

vi.mock('../../app/(apps)/docs/editor/page.module.css', () => ({
  default: new Proxy({}, { get: (_, k) => String(k) }),
}));
vi.mock('../../app/(apps)/docs/editor/remoteCursors.css', () => ({}));

// ---------------------------------------------------------------------------
// Module imports — after all vi.mock() calls
// ---------------------------------------------------------------------------

import { DocEditor } from '../../app/(apps)/docs/editor/DocEditor';
import { ApiClientError } from '@/lib/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
}

function renderDocEditor() {
  const qc = makeQueryClient();
  return render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(DocEditor))
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DocEditor — office-mode detection/fallback (issue #43)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConvertToHtml.mockResolvedValue({ value: '<p>Hello from docx</p>' });
  });

  it('falls back to storageApi.getFileMetadata when docsApi.getDoc 404s', async () => {
    mockGetDoc.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Document not found'));
    mockGetFileMetadata.mockResolvedValue({
      id: 'test-doc-id',
      name: 'report.docx',
      mimeType: DOCX_MIME,
    });
    mockDownloadFile.mockResolvedValue(new Blob(['fake docx bytes']));

    renderDocEditor();

    await waitFor(() => expect(mockGetFileMetadata).toHaveBeenCalledWith('test-doc-id'));
  });

  it('enters office mode and renders mammoth-converted content for a raw .docx file', async () => {
    mockGetDoc.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Document not found'));
    mockGetFileMetadata.mockResolvedValue({
      id: 'test-doc-id',
      name: 'report.docx',
      mimeType: DOCX_MIME,
    });
    mockDownloadFile.mockResolvedValue(new Blob(['fake docx bytes']));

    renderDocEditor();

    // Office mode must convert the downloaded raw bytes via mammoth rather
    // than treating the missing `docs` row as a genuine not-found state.
    await waitFor(() => expect(mockConvertToHtml).toHaveBeenCalled(), { timeout: 3000 });
    expect(screen.queryByText(/document not found/i)).not.toBeInTheDocument();
  });

  it('shows a genuine not-found state when the storage fallback ALSO 404s', async () => {
    mockGetDoc.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Document not found'));
    mockGetFileMetadata.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'File not found'));

    renderDocEditor();

    await waitFor(() => expect(screen.getByText(/document not found/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(mockConvertToHtml).not.toHaveBeenCalled();
  });

  it('does NOT enter office mode for a fallback file that is not an office format', async () => {
    mockGetDoc.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Document not found'));
    mockGetFileMetadata.mockResolvedValue({
      id: 'test-doc-id',
      name: 'photo.png',
      mimeType: 'image/png',
    });

    renderDocEditor();

    await waitFor(() => expect(mockGetFileMetadata).toHaveBeenCalled());
    expect(mockConvertToHtml).not.toHaveBeenCalled();
  });
});
