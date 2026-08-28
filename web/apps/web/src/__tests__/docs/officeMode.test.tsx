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
 *     file bytes and parses them with `readDocx` instead of showing a
 *     not-found state.
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

// A stable handle, so a test can assert the editor did *not* report a failure.
const mockToastError = vi.fn();

vi.mock('@neutrino/ui', () => ({
  Spinner: ({ overlay }: { overlay?: boolean }) =>
    React.createElement('div', { 'data-testid': 'spinner', 'data-overlay': overlay }),
  useToast: () => ({ warning: vi.fn(), success: vi.fn(), error: mockToastError, info: vi.fn() }),
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
  }),
}));

// ---------------------------------------------------------------------------
// The API mock is declared with `let` handles so each test can reconfigure
// getDoc / getFileMetadata behavior per-scenario.
// ---------------------------------------------------------------------------

const mockGetDoc = vi.fn();
const mockGetFileMetadata = vi.fn();
const mockDownloadFile = vi.fn();
/**
 * The office load path reads through `driveReadBytes`, not `downloadFile`
 * directly: a document that has just been created has no body at all, and the
 * download endpoint answers that with 409 `NO_CONTENT`. See the empty-document
 * test at the bottom of this file.
 */
const mockReadBytes = vi.fn();

vi.mock('@/lib/api', () => ({
  DEFAULT_PAGE_SETUP: {
    marginTop: 72, marginBottom: 72, marginLeft: 72, marginRight: 72,
    orientation: 'portrait', pageSize: 'letter',
  },
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
  },
  driveReadContent: vi.fn(() => Promise.resolve('')),
  driveReadBytes: (...args: unknown[]) => mockReadBytes(...args),
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

/**
 * The legacy OOXML container (issue #127). A `.docx` saved before the docx
 * writer was complete carries the editor's own model beside a Word document
 * that was only a projection of it, so the load path still prefers that model
 * where it exists. Nothing writes one any more. `readModel` is a handle so a
 * test can put the editor on either side of that fork; the container itself is
 * covered by `__tests__/ooxml/container.test.ts`.
 */
const mockReadNeutrinoModel = vi.fn<[], Promise<string | null>>(() => Promise.resolve(null));
vi.mock('@/lib/ooxmlContainer', () => ({
  readNeutrinoModel: () => mockReadNeutrinoModel(),
  looksLikeOoxml: () => true,
}));

/**
 * The docx parser, dynamically imported by the load path. Mocked rather than
 * run, because these tests hand the editor a Blob of `'fake docx bytes'` — the
 * parser's own behaviour on a real package is `__tests__/ooxml/`'s job.
 */
const mockReadDocx = vi.fn(() => Promise.resolve({
  doc: { type: 'doc', content: [] },
  meta: { pageSetup: { pageSize: 'letter' } },
}));
vi.mock('@/lib/ooxml/docx/read', () => ({ readDocx: () => mockReadDocx() }));

// The editor pulls in custom extensions from @/lib/extensions, which build on
// Extension/Node/Mark at module scope — so those have to exist on the mock even
// though no real editor is instantiated here.
vi.mock('@tiptap/react', () => {
  // `configure` is part of the surface too: DocEditor configures its own
  // extensions (PaginationExtension takes the page-count callback that way).
  const made = (config?: unknown) => ({ config, extend: () => stub, configure: () => made(config) });
  const stub = { create: made, extend: () => stub, configure: () => made(undefined) };
  return {
    useEditor: () => null,
    EditorContent: () => React.createElement('div', { 'data-testid': 'editor-content' }),
    Extension: stub,
    Node: stub,
    Mark: stub,
    mergeAttributes: (...objs: Record<string, unknown>[]) => Object.assign({}, ...objs),
    NodeViewWrapper: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    ReactNodeViewRenderer: () => () => null,
  };
});

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
    mockReadDocx.mockResolvedValue({
      doc: { type: 'doc', content: [] },
      meta: { pageSetup: { pageSize: 'letter' } },
    });
    mockReadNeutrinoModel.mockResolvedValue(null);
  });

  it('falls back to storageApi.getFileMetadata when docsApi.getDoc 404s', async () => {
    mockGetDoc.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Document not found'));
    mockGetFileMetadata.mockResolvedValue({
      id: 'test-doc-id',
      name: 'report.docx',
      mimeType: DOCX_MIME,
    });
    mockReadBytes.mockResolvedValue(new TextEncoder().encode('fake docx bytes'));

    renderDocEditor();

    await waitFor(() => expect(mockGetFileMetadata).toHaveBeenCalledWith('test-doc-id'));
  });

  it('enters office mode and parses the Word document for a raw .docx file', async () => {
    mockGetDoc.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Document not found'));
    mockGetFileMetadata.mockResolvedValue({
      id: 'test-doc-id',
      name: 'report.docx',
      mimeType: DOCX_MIME,
    });
    mockReadBytes.mockResolvedValue(new TextEncoder().encode('fake docx bytes'));

    renderDocEditor();

    // Office mode must parse the downloaded raw bytes rather than treating the
    // missing `docs` row as a genuine not-found state.
    await waitFor(() => expect(mockReadDocx).toHaveBeenCalled(), { timeout: 3000 });
    expect(screen.queryByText(/document not found/i)).not.toBeInTheDocument();
  });

  /**
   * A document last saved before the docx writer was complete. Parsing its
   * Word document would work — and would silently drop the footnotes, section
   * breaks, watermark, page setup and embedded sheets that the writer of the
   * day could not express — so the packed model still has to win for as long
   * as one is there.
   */
  it('prefers a legacy packed model over parsing the Word document', async () => {
    mockGetDoc.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Document not found'));
    mockGetFileMetadata.mockResolvedValue({
      id: 'test-doc-id',
      name: 'report.docx',
      mimeType: DOCX_MIME,
    });
    mockReadBytes.mockResolvedValue(new TextEncoder().encode('a packed .docx'));
    mockReadNeutrinoModel.mockResolvedValue(
      JSON.stringify({ doc: { type: 'doc', content: [] }, _meta: { pageSize: 'a4' } }),
    );

    renderDocEditor();

    await waitFor(() => expect(mockReadNeutrinoModel).toHaveBeenCalled());
    // The read resolving is the fork: everything after it is synchronous, so
    // one flush is enough to know the parser was not the branch taken.
    await Promise.resolve();
    expect(mockReadDocx).not.toHaveBeenCalled();
  });

  it('shows a genuine not-found state when the storage fallback ALSO 404s', async () => {
    mockGetDoc.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Document not found'));
    mockGetFileMetadata.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'File not found'));

    renderDocEditor();

    await waitFor(() => expect(screen.getByText(/document not found/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(mockReadDocx).not.toHaveBeenCalled();
  });

  /**
   * The state every document is in for the moment between "New document" and
   * its first save: `createDoc` inserts the Drive row with no body, because a
   * `.docx` is a zip the server has no business building. The download endpoint
   * answers that with 409 `NO_CONTENT`, which used to throw straight past the
   * empty branch and end on "Failed to open this file for editing" — so a new
   * document could not be opened at all. `driveReadBytes` reads it as no bytes.
   */
  it('opens a document whose body has never been written', async () => {
    mockGetDoc.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Document not found'));
    mockGetFileMetadata.mockResolvedValue({
      id: 'test-doc-id',
      name: 'Untitled document.docx',
      mimeType: DOCX_MIME,
    });
    mockReadBytes.mockResolvedValue(new Uint8Array(0));

    renderDocEditor();

    await waitFor(() => expect(mockReadBytes).toHaveBeenCalledWith('test-doc-id'));
    // Nothing to parse, and nothing to report: the blank document already on
    // screen is what an empty record should look like.
    await waitFor(() => expect(mockToastError).not.toHaveBeenCalled());
    expect(mockReadDocx).not.toHaveBeenCalled();
    expect(screen.queryByText(/document not found/i)).not.toBeInTheDocument();
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
    expect(mockReadDocx).not.toHaveBeenCalled();
  });
});
