/**
 * Tests for the Note Editor page's Drive-native data flow (post Phase 3 of
 * `agent_docs/notes-links-roadmap.md` — the notes CRUD API is gone; the editor
 * reads/writes the note as a plain Drive file plus the generic links service).
 *
 * Covers:
 *   - `storageApi.getFileInfo` is called with the note id from the URL search
 *     param, for permission-checked metadata (not `getFileMetadata`, which is
 *     owner-scoped only and would 404 for a shared note).
 *   - `linksApi.getBacklinks` is called with the same id.
 *   - `listAllNotes` (`@/lib/noteFiles`) — the whole-drive helper, since
 *     `filesystemApi.getRootContents`'s whole-drive `type=` filter was
 *     removed with the root listing route — feeds `BlockEditor.allNotes`
 *     directly; Drive-only fields (size, mime type, folder, content
 *     version) must not leak through, since that's all the wiki-link
 *     autocomplete needs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the module under test is imported
// ---------------------------------------------------------------------------

const NOTE_ID = 'note-1';

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'id' ? NOTE_ID : null) }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

const getFileInfoMock = vi.fn();
const downloadFileMock = vi.fn();
const driveReadContentMock = vi.fn();
const driveAutosaveContentMock = vi.fn();
const updateFileMock = vi.fn();

vi.mock('@neutrino/api-drive', () => ({
  filesystemApi: {
    updateFile: (...args: unknown[]) => updateFileMock(...args),
  },
  storageApi: {
    getFileInfo: (...args: unknown[]) => getFileInfoMock(...args),
    downloadFile: (...args: unknown[]) => downloadFileMock(...args),
  },
  driveReadContent: (...args: unknown[]) => driveReadContentMock(...args),
  driveAutosaveContent: (...args: unknown[]) => driveAutosaveContentMock(...args),
  driveAutosaveEncryptedContent: vi.fn(),
}));

const listAllNotesMock = vi.fn();
const extractNoteTextMock = vi.fn((raw: string) => raw);

vi.mock('@/lib/noteFiles', () => ({
  listAllNotes: (...args: unknown[]) => listAllNotesMock(...args),
  extractNoteText: (...args: unknown[]) => extractNoteTextMock(...args),
}));

const getBacklinksMock = vi.fn();
const updateLinksMock = vi.fn();

vi.mock('@neutrino/api-links', () => ({
  linksApi: {
    getBacklinks: (...args: unknown[]) => getBacklinksMock(...args),
    updateLinks: (...args: unknown[]) => updateLinksMock(...args),
  },
}));

// DEK resolution is exercised separately (see notes/note-encryption e2e specs)
// — here it's stubbed out so the editor treats content as unencrypted.
vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => ({
    dekRef: { current: null },
    dekResolved: true,
    isNewEncryption: false,
    autosave: vi.fn(),
    createVersion: vi.fn(),
    isAutosaving: false,
    isCreatingVersion: false,
    autosaveError: null,
    createVersionError: null,
  }),
}));

vi.mock('@neutrino/ui', () => ({
  Spinner: ({ overlay }: { overlay?: boolean }) => (
    <div data-testid="spinner" data-overlay={overlay} />
  ),
  // The editor warns through a toast when a save is rejected for being stale
  // (see `useContentVersionGuard`); these tests only need it to exist.
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

// Live-update relay — stubbed out here so these tests make no socket/token
// calls. Its behaviour is covered by useFileSync.test.ts and
// NoteEditorLiveSync.test.tsx.
vi.mock('@/hooks/useFileSync', () => ({
  useFileSync: () => ({ connected: true, broadcastFileUpdate: vi.fn() }),
}));

// BlockEditor is a large component — stub it and capture the `allNotes` prop
// it receives so we can assert the adapter shape without exercising the
// entire block-editing tree.
const blockEditorProps: Array<Record<string, unknown>> = [];

const MockBlockEditor = React.forwardRef(function MockBlockEditor(
  props: Record<string, unknown>,
  ref: React.Ref<{ selectAll: () => void }>
) {
  blockEditorProps.push(props);
  React.useImperativeHandle(ref, () => ({ selectAll: vi.fn() }));
  return <div data-testid="block-editor" />;
});

vi.mock('../../app/(apps)/notes/editor/BlockEditor', () => ({
  __esModule: true,
  default: MockBlockEditor,
  parseBlocks: vi.fn(() => []),
  serializeBlocks: vi.fn(() => ''),
}));

vi.mock('../../app/(apps)/notes/editor/MenuBar', () => ({ HamburgerMenu: () => null }));

vi.mock('../../app/(apps)/notes/editor/page.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNoteMeta(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'note-2',
    title: 'Other Note',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

async function renderEditorPage() {
  const { default: NoteEditorPage } = await import('../../app/(apps)/notes/editor/page');
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NoteEditorPage />
    </QueryClientProvider>
  );
}

function latestBlockEditorProps() {
  return blockEditorProps[blockEditorProps.length - 1] as {
    allNotes: Array<Record<string, unknown>>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  blockEditorProps.length = 0;
  listAllNotesMock.mockResolvedValue([]);
  extractNoteTextMock.mockImplementation((raw: string) => raw);
  getFileInfoMock.mockResolvedValue({
    id: NOTE_ID,
    name: 'Current Note',
    folderId: null,
    deletedAt: null,
    yourRole: 'owner',
    storagePath: '/some/path',
    mimeType: 'application/x-neutrino-note',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    coverThumbnail: null,
    coverThumbnailMimeType: null,
    tags: [],
    encryptedMetadata: null,
    contentVersion: 1,
  });
  driveReadContentMock.mockResolvedValue('body');
  getBacklinksMock.mockResolvedValue({ backlinks: [] });
  driveAutosaveContentMock.mockResolvedValue({
    id: NOTE_ID,
    name: 'Current Note',
    folderId: null,
    updatedAt: '2026-01-01T00:00:00Z',
    contentVersion: 2,
  });
  updateFileMock.mockResolvedValue({});
  updateLinksMock.mockResolvedValue({ backlinks: [] });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NoteEditorPage — "all notes" query', () => {
  it('calls listAllNotes to populate the wiki-link autocomplete source', async () => {
    await renderEditorPage();

    await waitFor(() => expect(listAllNotesMock).toHaveBeenCalled());
    expect(listAllNotesMock).toHaveBeenCalledTimes(1);
  });

  it('feeds listAllNotes results into BlockEditor.allNotes with id/title intact', async () => {
    listAllNotesMock.mockResolvedValue([makeNoteMeta({ id: 'note-2', title: 'Other Note' })]);

    await renderEditorPage();

    await waitFor(() => {
      expect(latestBlockEditorProps().allNotes).toHaveLength(1);
    });

    const allNotes = latestBlockEditorProps().allNotes;
    expect(allNotes[0]).toMatchObject({ id: 'note-2', title: 'Other Note' });

    // Drive-only fields (never part of NoteMeta) must not leak into the
    // wiki-link-autocomplete shape.
    expect(allNotes[0]).not.toHaveProperty('sizeBytes');
    expect(allNotes[0]).not.toHaveProperty('mimeType');
    expect(allNotes[0]).not.toHaveProperty('folderId');
    expect(allNotes[0]).not.toHaveProperty('contentVersion');
    expect(allNotes[0]).not.toHaveProperty('name');
  });
});

describe('NoteEditorPage — current-note operations', () => {
  it('calls storageApi.getFileInfo (permission-checked) with the note id from the URL', async () => {
    await renderEditorPage();

    await waitFor(() => expect(getFileInfoMock).toHaveBeenCalledWith(NOTE_ID));
  });

  it('calls linksApi.getBacklinks with the note id from the URL', async () => {
    await renderEditorPage();

    await waitFor(() => expect(getBacklinksMock).toHaveBeenCalledWith(NOTE_ID));
  });
});

describe('NoteEditorPage — Ctrl+A', () => {
  it('leaves the title field\'s native select-all alone', async () => {
    const { container } = await renderEditorPage();
    const title = await waitFor(() => {
      const el = container.querySelector('input[aria-label="Note title"]') as HTMLInputElement;
      if (!el) throw new Error('title input not rendered');
      return el;
    });

    title.focus();
    expect(document.activeElement).toBe(title);

    const evt = new KeyboardEvent('keydown', {
      key: 'a',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(evt);

    // Not prevented => the browser's own select-all runs inside the input.
    expect(evt.defaultPrevented).toBe(false);
  });

  it('takes over Ctrl+A when focus is outside the title field', async () => {
    const { container } = await renderEditorPage();
    await waitFor(() => {
      if (!container.querySelector('input[aria-label="Note title"]')) {
        throw new Error('title input not rendered');
      }
    });

    const evt = new KeyboardEvent('keydown', {
      key: 'a',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);
  });
});
