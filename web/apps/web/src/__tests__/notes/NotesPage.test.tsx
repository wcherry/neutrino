/**
 * Tests for the Notes list page's TARGET post-refactor behavior (in-progress
 * refactor: dedicated `notesApi.listNotes()` -> generic Drive API's typed
 * listing `filesystemApi.getRootContents({ type: 'note', ... })`).
 *
 * RED PHASE: the implementation on disk (apps/web/src/app/(apps)/notes/page.tsx)
 * still calls `notesApi.listNotes()` today, so these tests are expected to
 * FAIL until a follow-up change swaps the query over to `filesystemApi`.
 *
 * Covers:
 *   - `filesystemApi.getRootContents` is called with exactly
 *     `{ type: 'note', orderBy: 'createdAt', direction: 'desc' }`.
 *   - The old `notesApi.listNotes` is NOT called for the listing.
 *   - `FileGrid` receives grid items whose `name` comes from
 *     `FileItem.name` (not the old `NoteMetaResponse.title`).
 *   - `isLoading` / `isError` still pass through to `FileGrid` correctly.
 *   - The create / rename / delete mutations (still on `notesApi`, untouched
 *     by this refactor) keep invalidating the `['notes']` query key.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the module under test is imported
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

// `@/lib/api` — houses `notesApi`, still used for create/rename/delete.
// Rename no longer calls `getNote` (content is optional on save now — a pure
// rename doesn't need to fetch/preserve it), so there's no mock for it here.
const listNotesMock = vi.fn();
const createNoteMock = vi.fn();
const getNoteMock = vi.fn();
const saveNoteMock = vi.fn();
const deleteNoteMock = vi.fn();

vi.mock('@/lib/api', () => ({
  notesApi: {
    listNotes: (...args: unknown[]) => listNotesMock(...args),
    createNote: (...args: unknown[]) => createNoteMock(...args),
    getNote: (...args: unknown[]) => getNoteMock(...args),
    saveNote: (...args: unknown[]) => saveNoteMock(...args),
    deleteNote: (...args: unknown[]) => deleteNoteMock(...args),
  },
}));

// `@neutrino/api-drive` — separate module specifier from `@/lib/api`; the
// refactor imports `filesystemApi` directly from here, per repo convention
// for new code (see web/CLAUDE.md).
const getRootContentsMock = vi.fn();

vi.mock('@neutrino/api-drive', () => ({
  filesystemApi: {
    getRootContents: (...args: unknown[]) => getRootContentsMock(...args),
  },
}));

// `@neutrino/ui` — minimal stubs; FileGrid captures the props it receives so
// we can assert on `items`, `isLoading`, `isError` without depending on the
// real FileGrid's internal DOM structure.
const fileGridProps: Array<Record<string, unknown>> = [];

vi.mock('@neutrino/ui', () => ({
  Heading: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    onClick,
    disabled,
    type,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: 'button' | 'submit';
  }) => (
    <button type={type ?? 'button'} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
  FileGrid: (props: Record<string, unknown>) => {
    fileGridProps.push(props);
    return <div data-testid="file-grid" />;
  },
}));

vi.mock('@/components/DocumentPreviewModal', () => ({
  DocumentPreviewModal: () => null,
}));

// CSS modules
vi.mock('../../app/(apps)/notes/page.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));
vi.mock('../../app/(apps)/drive/FileContextMenu.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFileItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '1',
    name: 'My Note',
    sizeBytes: 0,
    mimeType: 'text/plain',
    folderId: null,
    isStarred: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
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

async function renderNotesPage() {
  const { default: NotesPage } = await import('../../app/(apps)/notes/page');
  const qc = makeQueryClient();
  const result = render(
    <QueryClientProvider client={qc}>
      <NotesPage />
    </QueryClientProvider>
  );
  return { ...result, qc };
}

function latestFileGridProps() {
  return fileGridProps[fileGridProps.length - 1] as {
    items: Array<{ id: string; name: string }>;
    isLoading?: boolean;
    isError?: boolean;
    onItemMenuOpen?: (item: { id: string; name: string }, e: unknown) => void;
  };
}

function fakeMenuEvent() {
  return {
    currentTarget: {
      getBoundingClientRect: () => ({ right: 100, bottom: 100 }),
    },
  } as unknown as React.MouseEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  fileGridProps.length = 0;
  getRootContentsMock.mockResolvedValue({ folder: null, folders: [], files: [], shortcuts: [] });
  listNotesMock.mockResolvedValue({ notes: [] });
  createNoteMock.mockResolvedValue({
    id: 'new-note',
    title: 'Untitled note',
    contentUrl: '/api/v1/drive/files/new-note',
    folderId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
  getNoteMock.mockResolvedValue({
    id: '1',
    title: 'My Note',
    contentUrl: '/api/v1/drive/files/1',
    folderId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
  saveNoteMock.mockResolvedValue({
    id: '1',
    title: 'Renamed',
    folderId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
  deleteNoteMock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotesPage — listing query (Drive API refactor)', () => {
  it('calls filesystemApi.getRootContents with exactly { type: "note", orderBy: "createdAt", direction: "desc" }', async () => {
    await renderNotesPage();

    await waitFor(() => expect(getRootContentsMock).toHaveBeenCalled());

    expect(getRootContentsMock).toHaveBeenCalledTimes(1);
    expect(getRootContentsMock).toHaveBeenCalledWith({
      type: 'note',
      orderBy: 'createdAt',
      direction: 'desc',
    });
  });

  it('does NOT call the old notesApi.listNotes for the listing', async () => {
    await renderNotesPage();

    await waitFor(() => expect(getRootContentsMock).toHaveBeenCalled());

    expect(listNotesMock).not.toHaveBeenCalled();
  });

  it('maps FileItem.name (not NoteMetaResponse.title) onto the grid item name', async () => {
    getRootContentsMock.mockResolvedValue({
      folder: null,
      folders: [],
      files: [makeFileItem({ id: '1', name: 'My Note', updatedAt: '2026-01-01T00:00:00Z' })],
      shortcuts: [],
    });

    await renderNotesPage();

    await waitFor(() => {
      const props = latestFileGridProps();
      expect(props.items).toHaveLength(1);
    });

    const props = latestFileGridProps();
    expect(props.items[0].id).toBe('1');
    expect(props.items[0].name).toBe('My Note');
  });

  it('passes isLoading=true to FileGrid while the query is pending', async () => {
    getRootContentsMock.mockReturnValue(new Promise(() => {})); // never resolves

    await renderNotesPage();

    await waitFor(() => expect(fileGridProps.length).toBeGreaterThan(0));
    expect(latestFileGridProps().isLoading).toBe(true);
  });

  it('passes isError=true to FileGrid when the query rejects', async () => {
    getRootContentsMock.mockRejectedValue(new Error('network error'));

    await renderNotesPage();

    await waitFor(() => {
      expect(latestFileGridProps().isError).toBe(true);
    });
  });
});

describe('NotesPage — content mutations (untouched by the listing refactor)', () => {
  // These exercise notesApi.createNote/getNote/saveNote/deleteNote directly —
  // behavior the refactor is NOT supposed to touch — via the "New Note"
  // button (always rendered, independent of listing state) and the
  // onItemMenuOpen callback captured off the mocked FileGrid (bypassing the
  // real grid's item rendering, since that depends on the listing query this
  // refactor changes).

  it('createNote still calls notesApi.createNote', async () => {
    await renderNotesPage();

    fireEvent.click(screen.getByRole('button', { name: /new note/i }));

    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1));
    expect(createNoteMock).toHaveBeenCalledWith({ title: 'Untitled note' });
  });

  it('rename calls notesApi.saveNote with title only (content untouched) and invalidates ["notes"] on success', async () => {
    const { qc } = await renderNotesPage();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    await waitFor(() => expect(fileGridProps.length).toBeGreaterThan(0));

    // Open the context menu via the onItemMenuOpen callback FileGrid received.
    act(() => {
      latestFileGridProps().onItemMenuOpen?.({ id: '1', name: 'My Note' }, fakeMenuEvent());
    });

    fireEvent.click(await screen.findByRole('menuitem', { name: /rename/i }));

    const input = screen.getByLabelText(/new note name/i);
    fireEvent.change(input, { target: { value: 'Renamed Note' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(saveNoteMock).toHaveBeenCalledTimes(1));
    // Rename no longer round-trips through getNote to preserve content —
    // content is optional on save now, so a pure rename omits it entirely.
    expect(getNoteMock).not.toHaveBeenCalled();
    expect(saveNoteMock).toHaveBeenCalledWith('1', { title: 'Renamed Note' });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notes'] })
    );
  });

  it('delete still calls notesApi.deleteNote and invalidates ["notes"] on success', async () => {
    const { qc } = await renderNotesPage();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    await waitFor(() => expect(fileGridProps.length).toBeGreaterThan(0));

    act(() => {
      latestFileGridProps().onItemMenuOpen?.({ id: '1', name: 'My Note' }, fakeMenuEvent());
    });

    fireEvent.click(await screen.findByRole('menuitem', { name: /move to trash/i }));

    await waitFor(() => expect(deleteNoteMock).toHaveBeenCalledWith('1'));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notes'] })
    );
  });
});
