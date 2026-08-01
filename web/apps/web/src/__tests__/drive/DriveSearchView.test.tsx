/**
 * The Drive search view (`/drive?q=…`) — the page the topbar box hands its
 * query to when the user presses Enter.
 *
 * The point of these tests is that search hits are rendered by the *same*
 * FileGrid Drive uses for its own listing, so the two look identical.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { FileText } from 'lucide-react';
import { ToastProvider } from '@neutrino/ui';

const push = vi.fn();
const replace = vi.fn();
let query = 'budget';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, back: vi.fn() }),
  usePathname: () => '/drive',
  useSearchParams: () => new URLSearchParams(query ? `q=${query}` : ''),
}));

const search = vi.fn();
vi.mock('@/hooks/useClientSearch', () => ({
  useClientSearch: () => ({ search }),
}));

vi.mock('@neutrino/auth', () => ({
  useAuth: () => ({ user: null, isLoading: false }),
  useUser: () => null,
}));

vi.mock('@/providers/FeatureFlagsProvider', () => ({
  useFeatureFlags: () => new Proxy({}, { get: () => false }),
  useFeatureFlagsLoaded: () => true,
}));

vi.mock('@/lib/api', () => ({
  storageApi: {
    uploadFile: vi.fn(),
    deleteFile: vi.fn(),
    downloadFile: vi.fn(),
    getFileDownloadUrl: vi.fn(() => 'https://example.com/file'),
  },
  filesystemApi: {
    getRootContents: vi.fn(() => Promise.resolve({ folder: null, folders: [], files: [], shortcuts: [] })),
    getFolderContents: vi.fn(() => Promise.resolve({ folder: null, folders: [], files: [], shortcuts: [] })),
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
  useUser: () => null,
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: vi.fn(),
  generateFileKey: vi.fn(),
  encryptFileKey: vi.fn(),
  encryptMetadata: vi.fn(),
  loadKeyPair: vi.fn(() => null),
}));

vi.mock('../../app/(apps)/drive/UploadZone', () => ({ UploadZone: () => null }));
vi.mock('../../app/(apps)/drive/PreviewModal', () => ({ PreviewModal: () => null }));
vi.mock('../../app/(apps)/drive/FileContextMenu', () => ({ FileContextMenu: () => null }));
vi.mock('../../app/(apps)/drive/FolderContextMenu', () => ({ FolderContextMenu: () => null }));
vi.mock('../../app/(apps)/drive/FileInfoPanel', () => ({ FileInfoPanel: () => null }));
vi.mock('../../app/(apps)/drive/ShareDialog', () => ({ ShareDialog: () => null }));
vi.mock('../../app/(apps)/drive/MoveFolderDialog', () => ({ MoveFolderDialog: () => null }));
vi.mock('@/components/DocumentPreviewModal', () => ({ DocumentPreviewModal: () => null }));

const HIT = {
  id: 'doc-1',
  title: 'Q3 Budget',
  subtitle: 'Document',
  href: '/docs/editor?id=doc-1',
  icon: FileText,
  iconColor: '#2563eb',
  mimeType: 'application/x-neutrino-doc',
  modified: 'Mar 3, 2026',
  updatedAt: Date.parse('2026-03-03T10:00:00Z'),
};

async function renderDrivePage() {
  const { default: DrivePage } = await import('../../app/(apps)/drive/page');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <DrivePage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  query = 'budget';
  search.mockResolvedValue([HIT]);
});

describe('Drive search view', () => {
  it('shows the search term as a dismissible filter chip', async () => {
    await renderDrivePage();

    const chip = await screen.findByTestId('drive-search-chip');
    expect(chip).toHaveTextContent('budget');
    expect(screen.getByRole('button', { name: 'Clear search filter budget' })).toBeInTheDocument();
  });

  it('renders hits through the Drive file grid', async () => {
    await renderDrivePage();

    expect(await screen.findByRole('listitem', { name: 'Q3 Budget' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Search results' })).toBeInTheDocument();
  });

  it('hides Quick access while showing results', async () => {
    await renderDrivePage();

    await screen.findByRole('listitem', { name: 'Q3 Budget' });
    expect(screen.queryByRole('heading', { name: 'Quick access' })).not.toBeInTheDocument();
  });

  it('opens the hit when its grid item is clicked', async () => {
    const user = userEvent.setup();
    await renderDrivePage();

    await user.click(await screen.findByRole('listitem', { name: 'Q3 Budget' }));

    expect(push).toHaveBeenCalledWith('/docs/editor?id=doc-1');
  });

  it('reports when nothing matched', async () => {
    search.mockResolvedValue([]);
    await renderDrivePage();

    expect(await screen.findByText('No matches')).toBeInTheDocument();
  });

  it('dismissing the chip returns to the plain Drive listing', async () => {
    const user = userEvent.setup();
    await renderDrivePage();

    await user.click(await screen.findByRole('button', { name: 'Clear search filter budget' }));

    expect(replace).toHaveBeenCalledWith('/drive');
  });

  it('runs no search and shows the normal listing without a query', async () => {
    query = '';
    await renderDrivePage();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Quick access' })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Files' })).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
    expect(screen.queryByTestId('drive-search-chip')).not.toBeInTheDocument();
  });
});
