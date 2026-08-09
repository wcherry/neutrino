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
 *   - `filesystemApi.getRootContents({ type: 'note' })` (no `orderBy`/
 *     `direction`, unlike the list page's call) is adapted into a
 *     `{ id, title }[]` shape for `BlockEditor.allNotes` — Drive-only fields
 *     (size, mime type, timestamps, etc.) must not leak through, since that's
 *     all the wiki-link autocomplete needs.
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

const getRootContentsMock = vi.fn();
const getFileInfoMock = vi.fn();
const downloadFileMock = vi.fn();
const driveReadContentMock = vi.fn();
const driveAutosaveContentMock = vi.fn();
const updateFileMock = vi.fn();

vi.mock('@neutrino/api-drive', () => ({
  filesystemApi: {
    getRootContents: (...args: unknown[]) => getRootContentsMock(...args),
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

vi.mock('../../app/(apps)/notes/editor/BlockEditor', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    blockEditorProps.push(props);
    return <div data-testid="block-editor" />;
  },
  parseBlocks: vi.fn(() => []),
  serializeBlocks: vi.fn(() => ''),
}));

vi.mock('../../app/(apps)/notes/editor/page.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFileItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'note-2',
    name: 'Other Note',
    sizeBytes: 0,
    mimeType: 'text/plain',
    folderId: null,
    isStarred: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    coverThumbnail: null,
    coverThumbnailMimeType: null,
    contentVersion: 1,
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
  getRootContentsMock.mockResolvedValue({ folder: null, folders: [], files: [], shortcuts: [] });
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
  it('calls filesystemApi.getRootContents with exactly { type: "note" } (no orderBy/direction)', async () => {
    await renderEditorPage();

    await waitFor(() => expect(getRootContentsMock).toHaveBeenCalled());

    expect(getRootContentsMock).toHaveBeenCalledTimes(1);
    expect(getRootContentsMock).toHaveBeenCalledWith({ type: 'note' });
  });

  it('adapts the Drive FileItem[] response into { id, title }[] for BlockEditor.allNotes', async () => {
    getRootContentsMock.mockResolvedValue({
      folder: null,
      folders: [],
      files: [makeFileItem({ id: 'note-2', name: 'Other Note' })],
      shortcuts: [],
    });

    await renderEditorPage();

    await waitFor(() => {
      expect(latestBlockEditorProps().allNotes).toHaveLength(1);
    });

    const allNotes = latestBlockEditorProps().allNotes;
    expect(allNotes).toEqual([{ id: 'note-2', title: 'Other Note' }]);

    // Drive-only fields must not leak into the wiki-link-autocomplete shape.
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
