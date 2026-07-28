/**
 * Tests for the Note Editor page's TARGET post-refactor behavior (in-progress
 * refactor: dedicated `notesApi.listNotes()` -> generic Drive API's typed
 * listing `filesystemApi.getRootContents({ type: 'note' })`, then adapted back
 * into the existing `NoteMetaResponse[]` shape so the deeper component tree
 * — `BlockEditor` and friends — stays untouched).
 *
 * RED PHASE: the implementation on disk
 * (apps/web/src/app/(apps)/notes/editor/page.tsx) still calls
 * `notesApi.listNotes()` and passes its `.notes` straight through, so these
 * tests are expected to FAIL until a follow-up change swaps the query over to
 * `filesystemApi` and adds the adapter.
 *
 * Covers:
 *   - `filesystemApi.getRootContents` is called with exactly `{ type: 'note' }`
 *     (no `orderBy`/`direction` — unlike the list page's call).
 *   - The old `notesApi.listNotes` is NOT called.
 *   - The Drive `FileItem[]` response is adapted into `NoteMetaResponse[]`
 *     (`.name` -> `.title`, Drive-only fields dropped) before being passed to
 *     `BlockEditor` as `allNotes`.
 *   - `notesApi.getNote` / `notesApi.getBacklinks` are still called with the
 *     note id taken from the URL search param.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

// `@/lib/api` — `notesApi.getNote` / `getBacklinks` / `saveNote` stay untouched.
const listNotesMock = vi.fn();
const getNoteMock = vi.fn();
const getBacklinksMock = vi.fn();
const saveNoteMock = vi.fn();

vi.mock('@/lib/api', () => ({
  notesApi: {
    listNotes: (...args: unknown[]) => listNotesMock(...args),
    getNote: (...args: unknown[]) => getNoteMock(...args),
    getBacklinks: (...args: unknown[]) => getBacklinksMock(...args),
    saveNote: (...args: unknown[]) => saveNoteMock(...args),
  },
}));

// `@neutrino/api-drive` — separate module specifier; the refactor imports
// `filesystemApi` directly from here for the "all notes" listing. Content is
// now fetched via `driveReadContent`/`storageApi` (note.contentUrl) rather
// than embedded in notesApi.getNote's response.
const getRootContentsMock = vi.fn();
const driveReadContentMock = vi.fn();

vi.mock('@neutrino/api-drive', () => ({
  filesystemApi: {
    getRootContents: (...args: unknown[]) => getRootContentsMock(...args),
  },
  storageApi: {
    downloadFile: vi.fn(),
  },
  driveReadContent: (...args: unknown[]) => driveReadContentMock(...args),
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
  listNotesMock.mockResolvedValue({ notes: [] });
  getNoteMock.mockResolvedValue({
    id: NOTE_ID,
    title: 'Current Note',
    contentUrl: `/api/v1/drive/files/${NOTE_ID}`,
    folderId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
  driveReadContentMock.mockResolvedValue('body');
  getBacklinksMock.mockResolvedValue({ backlinks: [] });
  saveNoteMock.mockResolvedValue({
    id: NOTE_ID,
    title: 'Current Note',
    folderId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NoteEditorPage — "all notes" query (Drive API refactor)', () => {
  it('calls filesystemApi.getRootContents with exactly { type: "note" } (no orderBy/direction)', async () => {
    await renderEditorPage();

    await waitFor(() => expect(getRootContentsMock).toHaveBeenCalled());

    expect(getRootContentsMock).toHaveBeenCalledTimes(1);
    expect(getRootContentsMock).toHaveBeenCalledWith({ type: 'note' });
  });

  it('does NOT call the old notesApi.listNotes', async () => {
    await renderEditorPage();

    await waitFor(() => expect(getRootContentsMock).toHaveBeenCalled());

    expect(listNotesMock).not.toHaveBeenCalled();
  });

  it('adapts the Drive FileItem[] response into NoteMetaResponse[] for BlockEditor.allNotes', async () => {
    getRootContentsMock.mockResolvedValue({
      folder: null,
      folders: [],
      files: [
        makeFileItem({
          id: 'note-2',
          name: 'Other Note',
          folderId: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
        }),
      ],
      shortcuts: [],
    });

    await renderEditorPage();

    await waitFor(() => {
      expect(latestBlockEditorProps().allNotes).toHaveLength(1);
    });

    const allNotes = latestBlockEditorProps().allNotes;
    expect(allNotes).toEqual([
      {
        id: 'note-2',
        title: 'Other Note',
        folderId: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      },
    ]);

    // Drive-only fields must not leak into the NoteMetaResponse-shaped array.
    expect(allNotes[0]).not.toHaveProperty('sizeBytes');
    expect(allNotes[0]).not.toHaveProperty('mimeType');
    expect(allNotes[0]).not.toHaveProperty('isStarred');
    expect(allNotes[0]).not.toHaveProperty('coverThumbnail');
    expect(allNotes[0]).not.toHaveProperty('coverThumbnailMimeType');
    expect(allNotes[0]).not.toHaveProperty('contentVersion');
    expect(allNotes[0]).not.toHaveProperty('name');
  });
});

describe('NoteEditorPage — current-note operations (untouched by the listing refactor)', () => {
  it('still calls notesApi.getNote with the note id from the URL search param', async () => {
    await renderEditorPage();

    await waitFor(() => expect(getNoteMock).toHaveBeenCalledWith(NOTE_ID));
  });

  it('still calls notesApi.getBacklinks with the note id from the URL search param', async () => {
    await renderEditorPage();

    await waitFor(() => expect(getBacklinksMock).toHaveBeenCalledWith(NOTE_ID));
  });
});
