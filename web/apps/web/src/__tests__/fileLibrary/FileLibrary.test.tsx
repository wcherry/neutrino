/**
 * Every app library — /docs, /sheets, /slides, /drawing, /diagrams and /notes — is `FileLibrary`:
 * My Drive narrowed to one kind of file. These tests pin down the three things that make that
 * true, each of which the per-app pages it replaced got wrong:
 *
 *   - each page differs only in the filter it sends to `GET /drive/files`;
 *   - sorting and paging are the server's, so the sort bar sorts and nothing stops at 200 files;
 *   - the cards and actions are Drive's (`fileToGridItem`, `useFileActions`), so a spreadsheet
 *     has its thumbnail, size and star here as it does in Drive.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { pushMock, listFiles, createNewItem, fileGridProps } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  listFiles: vi.fn(),
  createNewItem: vi.fn(),
  fileGridProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/sheets',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@neutrino/auth', () => ({
  useAuth: () => ({ user: null, isLoading: false }),
  useUser: () => null,
}));

vi.mock('@/lib/api', () => ({
  storageApi: {
    listFiles: (...args: unknown[]) => listFiles(...args),
    deleteFile: vi.fn(),
    downloadFile: vi.fn(),
    getThumbnailUrl: (url: string | null | undefined) => (url ? `https://api.test${url}` : null),
  },
  filesystemApi: { updateFile: vi.fn(), updateFolder: vi.fn(), deleteFolder: vi.fn() },
  teamsApi: { list: vi.fn(() => Promise.resolve({ teams: [] })) },
  downloadAndDecryptFile: vi.fn(),
  useUser: () => null,
}));

vi.mock('@/lib/newItems', () => ({
  createNewItem: (...args: unknown[]) => createNewItem(...args),
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: vi.fn(),
  loadKeyPair: vi.fn(() => null),
}));

vi.mock('@neutrino/ui', async (importOriginal) => ({
  // The real rail; the grid is recorded so its props can be inspected.
  ...(await importOriginal<typeof import('@neutrino/ui')>()),
  FileGrid: (props: Record<string, unknown>) => {
    fileGridProps.push(props);
    return <div data-testid="file-grid">{props.footer as React.ReactNode}</div>;
  },
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('../../app/(apps)/drive/UploadZone', () => ({ UploadZone: () => null }));
vi.mock('../../app/(apps)/drive/PreviewModal', () => ({ PreviewModal: () => null }));
vi.mock('../../app/(apps)/drive/FileContextMenu', () => ({ FileContextMenu: () => null }));
vi.mock('../../app/(apps)/drive/FolderContextMenu', () => ({ FolderContextMenu: () => null }));
vi.mock('../../app/(apps)/drive/FileInfoPanel', () => ({ FileInfoPanel: () => null }));
vi.mock('../../app/(apps)/drive/ShareDialog', () => ({ ShareDialog: () => null }));
vi.mock('../../app/(apps)/drive/MoveFolderDialog', () => ({ MoveFolderDialog: () => null }));
vi.mock('@/components/DocumentPreviewModal', () => ({ DocumentPreviewModal: () => null }));
vi.mock('../../app/(apps)/diagrams/TemplatePickerModal', () => ({ TemplatePickerModal: () => null }));
vi.mock('../../app/(apps)/docs/DocTemplatePickerModal', () => ({ DocTemplatePickerModal: () => null }));

import DocsPage from '../../app/(apps)/docs/page';
import SheetsPage from '../../app/(apps)/sheets/page';
import SlidesPage from '../../app/(apps)/slides/page';
import DrawingsPage from '../../app/(apps)/drawing/page';
import DiagramsPage from '../../app/(apps)/diagrams/page';
import NotesPage from '../../app/(apps)/notes/page';
import { LIBRARY_PAGE_SIZE } from '../../app/(apps)/FileLibrary';
import { DIAGRAM_MIME_TYPE, DIAGRAM_SVG_MIME_TYPE } from '@neutrino/api-diagrams';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function driveFile(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `${id}.xlsx`,
    sizeBytes: 4096,
    mimeType: XLSX,
    folderId: null,
    isStarred: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    coverThumbnailUrl: null,
    encryptedMetadata: null,
    tags: [],
    contentVersion: 1,
    ...over,
  };
}

function listing(items: unknown[], total = items.length) {
  return { items, total, page: 1, pageSize: LIBRARY_PAGE_SIZE, totalPages: 1 };
}

function renderPage(Page: React.ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Page />
    </QueryClientProvider>,
  );
}

type GridProps = {
  items: Array<{ id: string; name: string; subtitle?: string; thumbnailUrl?: string | null; isStarred?: boolean }>;
  isLoading?: boolean;
  isError?: boolean;
  onItemClick: (item: { id: string; kind: string }) => void;
  onToggleStar?: unknown;
  onItemMenuOpen?: unknown;
  onItemSelect?: unknown;
  onDrop?: unknown;
  showSizeColumn?: boolean;
  showFilter?: boolean;
  totalCount?: number;
  onSortChange: (field: string, dir: string) => void;
};

function grid(): GridProps {
  return fileGridProps[fileGridProps.length - 1] as unknown as GridProps;
}

beforeEach(() => {
  vi.clearAllMocks();
  fileGridProps.length = 0;
  listFiles.mockResolvedValue(listing([]));
  try { localStorage.clear(); } catch { /* jsdom without storage */ }
});

// ---------------------------------------------------------------------------
// One page per library, differing only in the filter
// ---------------------------------------------------------------------------

const LIBRARIES = [
  { name: 'Docs', Page: DocsPage, heading: 'Documents', filter: { type: 'doc' } },
  { name: 'Sheets', Page: SheetsPage, heading: 'Spreadsheets', filter: { type: 'sheet' } },
  { name: 'Slides', Page: SlidesPage, heading: 'Presentations', filter: { type: 'slide' } },
  { name: 'Drawings', Page: DrawingsPage, heading: 'Drawings', filter: { type: 'drawing' } },
  { name: 'Notes', Page: NotesPage, heading: 'Notes', filter: { type: 'note' } },
  // A diagram is stored as its own JSON or as an SVG, which no single backend `type` names.
  { name: 'Diagrams', Page: DiagramsPage, heading: 'Diagrams', filter: { mimeType: [DIAGRAM_MIME_TYPE, DIAGRAM_SVG_MIME_TYPE] } },
] as const;

describe.each(LIBRARIES)('$name library', ({ Page, heading, filter }) => {
  it(`renders the "${heading}" heading`, async () => {
    renderPage(Page);
    expect(await screen.findByText(heading)).toBeInTheDocument();
  });

  it('lists through the Drive file listing with its own filter, sorted by the server', async () => {
    renderPage(Page);
    await waitFor(() => expect(listFiles).toHaveBeenCalled());
    expect(listFiles).toHaveBeenCalledWith({
      ...filter,
      orderBy: 'updatedAt',
      direction: 'desc',
      limit: LIBRARY_PAGE_SIZE,
      offset: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Drive's cards and actions
// ---------------------------------------------------------------------------

describe('cards and actions', () => {
  it('maps files the way Drive does — full name, size, thumbnail and star', async () => {
    listFiles.mockResolvedValue(
      listing([driveFile('budget', { isStarred: true, coverThumbnailUrl: '/api/v1/drive/files/budget/thumbnail?v=2' })]),
    );
    renderPage(SheetsPage);

    await waitFor(() => expect(grid().items).toHaveLength(1));
    const [item] = grid().items;
    expect(item.name).toBe('budget.xlsx');
    expect(item.subtitle).toBe('4.0 KB');
    expect(item.thumbnailUrl).toBe('https://api.test/api/v1/drive/files/budget/thumbnail?v=2');
    expect(item.isStarred).toBe(true);
  });

  it('offers Drive’s actions: menu, star, multi-select and drag-in upload', async () => {
    renderPage(SheetsPage);
    await waitFor(() => expect(listFiles).toHaveBeenCalled());

    expect(typeof grid().onItemMenuOpen).toBe('function');
    expect(typeof grid().onToggleStar).toBe('function');
    expect(typeof grid().onItemSelect).toBe('function');
    expect(typeof grid().onDrop).toBe('function');
    expect(grid().showFilter).toBe(false);
  });

  it('opens a file in its editor, as a click in Drive does', async () => {
    listFiles.mockResolvedValue(listing([driveFile('budget')]));
    renderPage(SheetsPage);
    await waitFor(() => expect(grid().items).toHaveLength(1));

    act(() => grid().onItemClick({ id: 'budget', kind: 'file' }));

    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('/sheets/editor?id=budget'));
  });

  it('passes isLoading while the listing is pending and isError when it rejects', async () => {
    listFiles.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderPage(SheetsPage);
    await waitFor(() => expect(grid().isLoading).toBe(true));
    unmount();

    listFiles.mockRejectedValue(new Error('network'));
    renderPage(SheetsPage);
    await waitFor(() => expect(grid().isError).toBe(true));
  });
});

// ---------------------------------------------------------------------------
// Sorting and paging are the server's
// ---------------------------------------------------------------------------

describe('sorting and paging', () => {
  it('re-lists in the order the sort bar asks for', async () => {
    renderPage(SheetsPage);
    await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(1));

    act(() => grid().onSortChange('name', 'asc'));

    await waitFor(() =>
      expect(listFiles).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: 'name', direction: 'asc', offset: 0 })),
    );
  });

  it('counts every matching file, not the page loaded so far, and loads the next page on scroll', async () => {
    const firstPage = Array.from({ length: LIBRARY_PAGE_SIZE }, (_, i) => driveFile(`f${i}`));
    listFiles
      .mockResolvedValueOnce(listing(firstPage, 250))
      .mockResolvedValueOnce(listing([driveFile('f-next')], 250));

    let trigger: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) { trigger = cb; }
        observe() {}
        disconnect() {}
      },
    );

    renderPage(SheetsPage);
    await waitFor(() => expect(grid().items).toHaveLength(LIBRARY_PAGE_SIZE));
    expect(grid().totalCount).toBe(250);

    await waitFor(() => expect(trigger).not.toBeNull());
    act(() => trigger!([{ isIntersecting: true }]));

    await waitFor(() =>
      expect(listFiles).toHaveBeenLastCalledWith(expect.objectContaining({ offset: LIBRARY_PAGE_SIZE })),
    );
    await waitFor(() => expect(grid().items).toHaveLength(LIBRARY_PAGE_SIZE + 1));
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

describe('creating', () => {
  it('creates through the same table as the New menu and opens the result', async () => {
    createNewItem.mockResolvedValue('/sheets/editor?id=new-1');
    renderPage(SheetsPage);

    fireEvent.click((await screen.findAllByRole('button', { name: /new spreadsheet/i }))[0]);

    await waitFor(() => expect(createNewItem).toHaveBeenCalledWith('sheet'));
    expect(pushMock).toHaveBeenCalledWith('/sheets/editor?id=new-1');
  });

  it('lets Diagrams start from its template picker instead', async () => {
    renderPage(DiagramsPage);

    fireEvent.click((await screen.findAllByRole('button', { name: /new diagram/i }))[0]);

    expect(createNewItem).not.toHaveBeenCalled();
  });
});
