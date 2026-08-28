/**
 * Regression test: headers and footers are not behind a feature flag.
 *
 * They used to be, inherited from the layout/structure flag that the old
 * header/footer dialog sat behind. With that flag off — which is its state
 * until the flags endpoint answers, and its permanent state on any deployment
 * that never enabled it — the Format menu had no entry and the margins had no
 * double-click target, so the feature was unreachable rather than merely
 * unstyled. These render with every flag off, which is the condition that broke.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';


// ---------------------------------------------------------------------------
// All vi.mock() calls before the module under test is imported.
// ---------------------------------------------------------------------------

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
  }),
}));

const mockGetDoc = vi.fn();

vi.mock('@/lib/api', () => ({
  DEFAULT_PAGE_SETUP: {
    marginTop: 72, marginBottom: 72, marginLeft: 72, marginRight: 72,
    orientation: 'portrait', pageSize: 'letter',
  },
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
  driveCreateVersion: vi.fn(() => Promise.resolve()),
  driveCreateEncryptedVersion: vi.fn(() => Promise.resolve()),
  driveAutosaveEncryptedContent: vi.fn(() => Promise.resolve()),
  storageApi: {
    getFileMetadata: vi.fn(() => Promise.resolve(null)),
    downloadFile: vi.fn(() => Promise.resolve(new Blob())),
    uploadFile: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@neutrino/e2e-crypto', () => ({ decryptFile: vi.fn() }));

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

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderEditor() {
  return render(
    React.createElement(QueryClientProvider, { client: client() },
      React.createElement(DocEditor)),
  );
}

beforeEach(() => {
  mockGetDoc.mockResolvedValue({
    id: 'test-doc-id',
    title: 'Doc',
    content: '',
  });
});

afterEach(() => { vi.clearAllMocks(); });

describe('headers and footers with docsLayoutStructure off', () => {
  it('still draws the bands, so the margins are a double-click target', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('editor-content')).toBeTruthy());

    expect(screen.getAllByTitle('Double-click to edit the header').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('Double-click to edit the footer').length).toBeGreaterThan(0);
  });

  it('opens the band toolbar on a double-click in a margin', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('editor-content')).toBeTruthy());
    expect(screen.queryByRole('toolbar', { name: 'Header and footer tools' })).toBeNull();

    fireEvent.doubleClick(screen.getAllByTitle('Double-click to edit the header')[0]);

    expect(screen.getByRole('toolbar', { name: 'Header and footer tools' })).toBeTruthy();
    expect(screen.getAllByLabelText('Header, left').length).toBeGreaterThan(0);
  });
});
