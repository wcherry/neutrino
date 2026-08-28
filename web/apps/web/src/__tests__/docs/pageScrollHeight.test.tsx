/**
 * Regression test: the docs editor must size its page container to the full
 * height of the document, not to a single sheet of paper.
 *
 * The page div lives behind a loading gate (`if (isLoading || !docId) return
 * <Spinner/>`), so it does not exist on the first render. The ResizeObserver
 * that measures it therefore cannot be attached by a mount-time effect with
 * empty deps — it finds a null ref, bails, and never runs again. With
 * `pageScrollHeight` stuck at 0 the zoom wrapper falls back to one page height
 * and, because it is `overflow: hidden`, everything past page 1 is clipped and
 * unreachable: the document appears cut off mid-line with nothing to scroll to.
 *
 * These tests pin down that the observer is attached to the page div once it
 * mounts, and that what it reports drives the wrapper's height.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Letter portrait at 96 dpi — one sheet. */
const ONE_PAGE_PX = 11 * 96;
/** 0.5in of blank space between two sheets (DocEditor's PAGE_GAP_PX). */
const GAP_PX = 48;
/** A document three sheets long, as the observer would report it. */
const THREE_PAGES_PX = ONE_PAGE_PX * 3 + GAP_PX * 2;

type Observed = { el: Element; owner: FakeResizeObserver; notify: () => void };

let observed: Observed[] = [];
let realResizeObserver: typeof ResizeObserver;

class FakeResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(el: Element) {
    observed.push({
      el,
      owner: this,
      notify: () => this.cb([], this as unknown as ResizeObserver),
    });
  }
  unobserve(el: Element) {
    observed = observed.filter(o => !(o.owner === this && o.el === el));
  }
  disconnect() {
    observed = observed.filter(o => o.owner !== this);
  }
}

function renderDocEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(DocEditor))
  );
}

function pageEl(container: HTMLElement) {
  return container.querySelector('.page') as HTMLElement | null;
}

function zoomWrapEl(container: HTMLElement) {
  return container.querySelector('.pageZoomWrap') as HTMLElement | null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DocEditor — page height measurement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    observed = [];
    realResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    mockGetDoc.mockResolvedValue({
      id: 'test-doc-id',
      title: 'Long document',
      contentUrl: null,
      contentVersion: 1,
    });
  });

  afterEach(() => {
    globalThis.ResizeObserver = realResizeObserver;
  });

  it('observes the page div even though it mounts after the loading gate', async () => {
    const { container } = renderDocEditor();

    // The page div does not exist on first render — the spinner does.
    await waitFor(() => expect(pageEl(container)).not.toBeNull());

    expect(observed.some(o => o.el === pageEl(container))).toBe(true);
  });

  it('grows the zoom wrapper to the full document height, not one page', async () => {
    const { container } = renderDocEditor();
    await waitFor(() => expect(pageEl(container)).not.toBeNull());

    const page = pageEl(container)!;
    Object.defineProperty(page, 'scrollHeight', { value: THREE_PAGES_PX, configurable: true });
    await act(async () => {
      observed.filter(o => o.el === page).forEach(o => o.notify());
    });

    // Regression: stuck at 0, this fell back to one page height and clipped
    // pages 2-3 behind `overflow: hidden`. The wrapper follows what the sheet
    // actually renders — how many pages that is, is PaginationExtension's
    // answer, not this measurement's (issue #136).
    expect(zoomWrapEl(container)!.style.height).toBe(`${THREE_PAGES_PX}px`);
  });
});
