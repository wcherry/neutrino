/**
 * Unit tests for My Drive's infinite scroll (issue #148).
 *
 * The folder listing used to fetch a single page of 200 items and stop, so a
 * folder with more than 200 files showed only the first 200. It now pages
 * through the listing as the grid is scrolled.
 *
 * Covers:
 *   - A full first page renders and offers a load-more sentinel
 *   - Scrolling the sentinel into view fetches the next page at the right offset
 *   - Items from every fetched page are shown, folders before files
 *   - A short page ends the listing (no sentinel, no further requests)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const PAGE_SIZE = 200;

// ---------------------------------------------------------------------------
// Mocks — must be declared before the module under test is imported
// ---------------------------------------------------------------------------

vi.mock('../../app/(apps)/drive/UploadZone', () => ({ UploadZone: () => null }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/drive',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@neutrino/auth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, isLoading: false }),
  useUser: () => ({ id: 'user-1' }),
}));

function makeFile(n: number) {
  return {
    id: `file-${n}`,
    name: `file-${n}.txt`,
    mimeType: 'text/plain',
    size: 10,
    folderId: null,
    isStarred: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeFolder(n: number) {
  return {
    id: `folder-${n}`,
    name: `folder-${n}`,
    parentId: null,
    isStarred: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/** Every folder-contents request the page made, in order. */
const contentsCalls: Array<{ offset?: number; limit?: number }> = [];

vi.mock('@/lib/api', () => ({
  storageApi: {
    getFileMetadata: vi.fn(),
    getFileDownloadUrl: vi.fn(() => 'https://example.com/file'),
  },
  filesystemApi: {
    getFolderContents: vi.fn((_folderId: string, query: { offset?: number; limit?: number } = {}) => {
      contentsCalls.push(query);
      const offset = query.offset ?? 0;
      if (offset === 0) {
        return Promise.resolve({
          folder: null,
          folders: [makeFolder(0)],
          files: Array.from({ length: PAGE_SIZE }, (_, i) => makeFile(i)),
        });
      }
      return Promise.resolve({
        folder: null,
        folders: [],
        files: [makeFile(PAGE_SIZE), makeFile(PAGE_SIZE + 1)],
      });
    }),
    getStarred: vi.fn(() => Promise.resolve({ folders: [], files: [] })),
    createFolder: vi.fn(),
    updateFile: vi.fn(),
    updateFolder: vi.fn(),
    deleteFolder: vi.fn(),
  },
  authApi: { getProfile: vi.fn() },
  docsApi: { createDoc: vi.fn() },
  sheetsApi: { createSheet: vi.fn() },
  slidesApi: { createSlide: vi.fn() },
  downloadAndDecryptFile: vi.fn(),
  useUser: () => ({ id: 'user-1' }),
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: vi.fn(),
  loadKeyPair: vi.fn(() => null),
  subscribeToLockState: vi.fn(() => () => {}),
}));

// UI package — the grid is stubbed down to the item names plus the footer the
// page hands it, which is where the infinite-scroll sentinel lives.
vi.mock('@neutrino/ui', () => ({
  Heading: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Breadcrumbs: () => <nav />,
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  Skeleton: () => <div />,
  FileGrid: ({ items, footer }: { items: Array<{ id: string; name: string }>; footer?: React.ReactNode }) => (
    <div data-testid="file-grid">
      <div data-testid="item-ids">{items.map((i) => i.id).join(',')}</div>
      {footer && <div data-testid="grid-footer">{footer}</div>}
    </div>
  ),
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../app/(apps)/drive/PreviewModal', () => ({ PreviewModal: () => null }));
vi.mock('../../app/(apps)/drive/FileContextMenu', () => ({ FileContextMenu: () => null }));
vi.mock('../../app/(apps)/drive/FolderContextMenu', () => ({ FolderContextMenu: () => null }));
vi.mock('../../app/(apps)/drive/FileInfoPanel', () => ({ FileInfoPanel: () => null }));
vi.mock('../../app/(apps)/drive/ShareDialog', () => ({ ShareDialog: () => null }));
vi.mock('../../app/(apps)/drive/MoveFolderDialog', () => ({ MoveFolderDialog: () => null }));
vi.mock('@/components/DocumentPreviewModal', () => ({ DocumentPreviewModal: () => null }));
vi.mock('@/lib/file-icons', () => ({
  getFileIcon: vi.fn(() => 'File'),
  getIconColor: vi.fn(() => '#000'),
}));
vi.mock('../../app/(apps)/drive/page.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Observed sentinels, so a test can say "this scrolled into view". */
let observed: Array<{ element: Element; trigger: () => void }> = [];

class FakeIntersectionObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(element: Element) {
    observed.push({
      element,
      trigger: () =>
        this.callback(
          [{ isIntersecting: true, target: element } as unknown as IntersectionObserverEntry],
          this as unknown as IntersectionObserver
        ),
    });
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

async function renderDrivePage() {
  const { default: DrivePage } = await import('../../app/(apps)/drive/page');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return render(
    <QueryClientProvider client={qc}>
      <DrivePage />
    </QueryClientProvider>
  );
}

function itemIds(): string[] {
  const text = screen.getByTestId('item-ids').textContent ?? '';
  return text ? text.split(',') : [];
}

beforeEach(() => {
  contentsCalls.length = 0;
  observed = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Drive infinite scroll', () => {
  it('requests one page of 200 items on load and watches for more', async () => {
    await renderDrivePage();

    await waitFor(() => expect(itemIds()).toHaveLength(PAGE_SIZE + 1));
    expect(contentsCalls).toEqual([{ limit: PAGE_SIZE, offset: 0, orderBy: 'updatedAt', direction: 'desc' }]);
    await waitFor(() => expect(observed.length).toBeGreaterThan(0));
  });

  it('fetches the next page when the sentinel scrolls into view', async () => {
    await renderDrivePage();
    await waitFor(() => expect(observed.length).toBeGreaterThan(0));

    act(() => observed[observed.length - 1].trigger());

    await waitFor(() => expect(contentsCalls).toHaveLength(2));
    expect(contentsCalls[1].offset).toBe(PAGE_SIZE);

    // Folders first, then the files from both pages.
    await waitFor(() => expect(itemIds()).toHaveLength(PAGE_SIZE + 3));
    expect(itemIds()[0]).toBe('folder-0');
    expect(itemIds()).toContain(`file-${PAGE_SIZE}`);
    expect(itemIds()).toContain(`file-${PAGE_SIZE + 1}`);
  });

  it('stops once a page comes back short', async () => {
    await renderDrivePage();
    await waitFor(() => expect(observed.length).toBeGreaterThan(0));

    act(() => observed[observed.length - 1].trigger());
    await waitFor(() => expect(itemIds()).toHaveLength(PAGE_SIZE + 3));

    // The second page was short, so the sentinel is gone and nothing else is
    // requested even if a stale observer fires.
    expect(screen.queryByTestId('grid-footer')).toBeNull();
    act(() => observed[observed.length - 1].trigger());
    await new Promise((r) => setTimeout(r, 0));
    expect(contentsCalls).toHaveLength(2);
  });
});
