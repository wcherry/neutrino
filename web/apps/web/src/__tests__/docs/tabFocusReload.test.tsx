/**
 * Regression test for issue #141 — the docs editor rebuilt itself every time
 * the user came back to the browser tab.
 *
 * `docsApi.getDoc` 404s for a `.docx`, which is every document created since
 * #127, so `['doc', id]` is a query that holds no data. React Query treats a
 * dataless query as stale whatever its `staleTime`, refetches it on every
 * window focus, and — because refetching with `data === undefined` resets the
 * status to `pending` — that refetch put `isLoading` back up. The editor's
 * loading gate swaps the whole editor for a spinner, so alt-tabbing threw away
 * the open document, its scroll position and its measured page layout, then
 * loaded it all again.
 *
 * Two things are pinned down here: returning to the tab must not re-run the
 * document queries, and the loading gate must not reopen once a document has
 * been resolved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';

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
    // No key: the body is read in the clear, through `driveReadContent`. What
    // the content query reads is not the point here; that it is not re-read on
    // every tab switch is.
    awaitDek: async () => null,
    isNewEncryption: false,
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
// getDoc / getFileInfo behavior per-scenario.
// ---------------------------------------------------------------------------

const mockGetDoc = vi.fn();
const mockGetFileInfo = vi.fn();
const mockDownloadFile = vi.fn();
/**
 * The office load path reads through `driveReadBytes`, not `downloadFile`
 * directly: a document that has just been created has no body at all, and the
 * download endpoint answers that with 409 `NO_CONTENT`. See the empty-document
 * test at the bottom of this file.
 */
const mockReadBytes = vi.fn();
/** The plaintext body read — the native-document counterpart of readBytes. */
const mockReadContent = vi.fn(() => Promise.resolve('{"type":"doc","content":[]}'));

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
  driveReadContent: (...args: unknown[]) => mockReadContent(...(args as [])),
  driveReadBytes: (...args: unknown[]) => mockReadBytes(...args),
  driveCreateVersion: vi.fn(() => Promise.resolve()),
  driveCreateEncryptedVersion: vi.fn(() => Promise.resolve()),
  driveAutosaveEncryptedContent: vi.fn(() => Promise.resolve()),
  storageApi: {
    // The office fallback reads `/info`, which resolves the file for anyone
    // with a role on it — `getFileMetadata` is scoped to the owner alone.
    getFileInfo: (...args: unknown[]) => mockGetFileInfo(...args),
    getFileMetadata: vi.fn(),
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
const mockReadNeutrinoModel = vi.fn<() => Promise<string | null>>(() => Promise.resolve(null));
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


import { DocEditor } from '../../app/(apps)/docs/editor/DocEditor';
import { ApiClientError } from '@/lib/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deliberately not `staleTime: Infinity`, which most of the other DocEditor
 * suites use: the bug lives in the refetch behaviour, and a dataless query is
 * stale under any staleTime anyway. `refetchOnWindowFocus` is left at its
 * default (on), because switching it off globally is exactly what the app does
 * not do — the queries in DocEditor opt out for themselves.
 */
function renderDocEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(DocEditor))
  );
}

/** Leave the tab and come back — what React Query hears as a focus event. */
async function switchAwayAndBack() {
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DocEditor — returning to the browser tab (issue #141)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    focusManager.setFocused(undefined);
    mockReadNeutrinoModel.mockResolvedValue(null);
  });

  it('keeps a .docx open — no reload of the document, no spinner', async () => {
    mockGetDoc.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Document not found'));
    mockGetFileInfo.mockResolvedValue({
      id: 'test-doc-id',
      name: 'report.docx',
      mimeType: DOCX_MIME,
    });
    mockReadBytes.mockResolvedValue(new TextEncoder().encode('fake docx bytes'));

    renderDocEditor();
    await waitFor(() => expect(screen.getByTestId('editor-content')).toBeInTheDocument());

    await switchAwayAndBack();

    // The 404 is the answer, not a failure to be re-asked for: re-running it is
    // what reset the query to `pending` and took the editor down with it.
    expect(mockGetDoc).toHaveBeenCalledTimes(1);
    expect(mockGetFileInfo).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    expect(screen.getByTestId('editor-content')).toBeInTheDocument();
  });

  it('does not re-download the body of a native document', async () => {
    mockGetDoc.mockResolvedValue({
      id: 'test-doc-id',
      title: 'Report',
      contentUrl: '/api/v1/drive/files/test-doc-id',
      contentVersion: 3,
    });
    mockDownloadFile.mockResolvedValue(new Blob(['{"type":"doc","content":[]}']));

    renderDocEditor();
    await waitFor(() => expect(screen.getByTestId('editor-content')).toBeInTheDocument());
    const bodyReads = mockDownloadFile.mock.calls.length + mockReadContent.mock.calls.length;

    await switchAwayAndBack();

    expect(mockGetDoc).toHaveBeenCalledTimes(1);
    expect(mockDownloadFile.mock.calls.length + mockReadContent.mock.calls.length).toBe(bodyReads);
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
  });

  /**
   * The gate itself, independent of what triggers the fetch. Once a document is
   * on screen, a later fetch of these queries — an invalidation, a reconnect —
   * must leave it there rather than replacing it with a spinner over an answer
   * we already have.
   */
  it('does not reopen the loading gate once the document has been resolved', async () => {
    mockGetDoc.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'Document not found'));
    mockGetFileInfo.mockResolvedValue({
      id: 'test-doc-id',
      name: 'report.docx',
      mimeType: DOCX_MIME,
    });
    mockReadBytes.mockResolvedValue(new TextEncoder().encode('fake docx bytes'));

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(DocEditor))
    );
    await waitFor(() => expect(screen.getByTestId('editor-content')).toBeInTheDocument());

    let pending: (v: unknown) => void = () => {};
    mockGetDoc.mockImplementation(() => new Promise((_, reject) => {
      pending = () => reject(new ApiClientError(404, 'NOT_FOUND', 'Document not found'));
    }));
    await act(async () => {
      void qc.refetchQueries({ queryKey: ['doc', 'test-doc-id'] });
      await Promise.resolve();
    });

    // In flight, with no data behind it — the state that used to render a
    // spinner over a perfectly good document.
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    expect(screen.getByTestId('editor-content')).toBeInTheDocument();
    await act(async () => { pending(undefined); await Promise.resolve(); });
  });
});
