/**
 * The local import panel (`components/LocalImport/`).
 *
 * The parts under test are the ones a user acts on: picking a folder shows
 * what was found, each kind present gets a destination select with its
 * default, the one button counts what will actually be imported, a quota
 * that will not fit stops the import before it starts, and Import hands a
 * `local` run to the provider. The runner is mocked; nothing uploads.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { QuotaInfo } from '@neutrino/api-drive';
import type { ImportSummary } from '@/lib/takeout';

const { pushMock, getQuota, canEncryptFor, buildLocalImportSteps } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  getQuota: vi.fn(),
  canEncryptFor: vi.fn(),
  buildLocalImportSteps: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/drive',
}));

vi.mock('@neutrino/api-drive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@neutrino/api-drive')>();
  return {
    ...actual,
    canEncryptFor: (...args: unknown[]) => canEncryptFor(...args),
    storageApi: { ...actual.storageApi, getQuota: () => getQuota() },
  };
});

vi.mock('@neutrino/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@neutrino/auth')>();
  return { ...actual, useUser: () => ({ id: 'user-1', name: 'Test', email: 't@example.com' }) };
});

vi.mock('@/lib/localImport/runLocalImport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/localImport/runLocalImport')>();
  return { ...actual, buildLocalImportSteps: (...args: unknown[]) => buildLocalImportSteps(...args) };
});

import { LocalImport } from '@/components/LocalImport';
import { ImportRunProvider, useImportRun } from '@/components/ImportRun';

const unlimited = (extra: Partial<QuotaInfo> = {}): QuotaInfo =>
  ({
    usedBytes: 0,
    quotaBytes: null,
    dailyUploadBytes: 0,
    dailyCapBytes: null,
    dailyResetAt: '2026-10-25T00:00:00Z',
    ...extra,
  }) as QuotaInfo;

function fileAt(path: string, size: number, type = ''): File {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const file = new File([new Uint8Array(size)], name, { type });
  Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true });
  return file;
}

/** Holiday/: a photo, a Word file, a note and a text file in a subfolder. */
const holiday = () => [
  fileAt('Holiday/beach.png', 1000, 'image/png'),
  fileAt('Holiday/report.docx', 2000),
  fileAt('Holiday/ideas.md', 300),
  fileAt('Holiday/misc/readme.txt', 50, 'text/plain'),
];

function pick(files: File[]) {
  const input = screen.getByTestId('local-import-folder-input') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  act(() => {
    fireEvent.change(input);
  });
}

function StateProbe() {
  const { state } = useImportRun();
  const kind = state.status === 'idle' ? 'none' : state.kind;
  return <span data-testid="probe">{`${state.status}:${kind}`}</span>;
}

function renderPanel(props: React.ComponentProps<typeof LocalImport> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ImportRunProvider>
        <LocalImport {...props} />
        <StateProbe />
      </ImportRunProvider>
    </QueryClientProvider>,
  );
}

const select = (label: string) => screen.queryByRole('combobox', { name: `Destination for ${label}` }) as HTMLSelectElement | null;
const importButton = () => screen.getByRole('button', { name: /^Import \d[\d,]* files?$/ }) as HTMLButtonElement;

beforeEach(() => {
  pushMock.mockReset();
  getQuota.mockReset().mockResolvedValue(unlimited());
  canEncryptFor.mockReset().mockResolvedValue(true);
  buildLocalImportSteps.mockReset().mockImplementation(({ planned }: { planned: unknown[] }) => [
    {
      product: 'Drive',
      count: planned.length,
      // Never finishes: the run stays `running`, so nothing after it matters.
      run: () => new Promise<ImportSummary>(() => {}),
    },
  ]);
});

describe('LocalImport — what was picked', () => {
  it('shows nothing to import before a pick', () => {
    renderPanel();
    expect(screen.queryByRole('region', { name: 'What will be imported' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Import \d/ })).toBeNull();
  });

  it('counts and sizes the picked folder', () => {
    renderPanel();
    pick(holiday());

    expect(screen.getByText(/Found in “Holiday”/)).toBeTruthy();
    // 1000 + 2000 + 300 + 50 bytes.
    expect(screen.getByText('4 files · 3.3 KB')).toBeTruthy();
  });

  it('gives each kind present a destination select set to its default', () => {
    renderPanel();
    pick(holiday());

    expect(select('Photos & videos')?.value).toBe('photos-drive');
    expect(select('Word, Excel, PowerPoint')?.value).toBe('drive');
    expect(select('Markdown notes')?.value).toBe('notes');
    expect(select('Everything else')?.value).toBe('drive');
  });

  it('shows no select for a kind with no files', () => {
    renderPanel();
    pick([fileAt('Trip/a.jpg', 10, 'image/jpeg'), fileAt('Trip/b.jpg', 10, 'image/jpeg')]);

    expect(select('Photos & videos')).toBeTruthy();
    expect(select('Word, Excel, PowerPoint')).toBeNull();
    expect(select('Markdown notes')).toBeNull();
    expect(select('Everything else')).toBeNull();
  });

  it('labels the button with the number of files', () => {
    renderPanel();
    pick(holiday());
    expect(importButton().textContent).toBe('Import 4 files');
  });

  it('says "file" for one', () => {
    renderPanel();
    pick([fileAt('Trip/a.jpg', 10, 'image/jpeg')]);
    expect(importButton().textContent).toBe('Import 1 file');
  });

  it("drops a kind set to Don't import from the count", () => {
    renderPanel();
    pick(holiday());

    act(() => {
      fireEvent.change(select('Markdown notes')!, { target: { value: 'skip' } });
    });

    expect(select('Markdown notes')?.value).toBe('skip');
    expect(importButton().textContent).toBe('Import 3 files');
  });
});

describe('LocalImport — the quota check', () => {
  it('says why and disables Import when the files will not fit', async () => {
    getQuota.mockResolvedValue(unlimited({ usedBytes: 1000, quotaBytes: 2000 }));
    renderPanel();
    pick(holiday());

    await waitFor(() => expect(screen.getByText(/of your storage is free/)).toBeTruthy());
    expect(importButton().disabled).toBe(true);
  });

  it('enables Import when the files fit', async () => {
    getQuota.mockResolvedValue(unlimited({ usedBytes: 0, quotaBytes: 1_000_000 }));
    renderPanel();
    pick(holiday());

    await waitFor(() => expect(getQuota).toHaveBeenCalled());
    expect(importButton().disabled).toBe(false);
    expect(screen.queryByText(/of your storage is free/)).toBeNull();
  });
});

describe('LocalImport — starting', () => {
  it("hands a 'local' run to the provider with the planned files", async () => {
    const onStarted = vi.fn();
    renderPanel({ onStarted });
    pick(holiday());

    await act(async () => {
      importButton().click();
    });

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('running:local'));
    expect(buildLocalImportSteps).toHaveBeenCalledTimes(1);
    const args = buildLocalImportSteps.mock.calls[0][0] as { planned: unknown[]; baseFolderId: string | null; userId: string };
    expect(args.planned).toHaveLength(4);
    expect(args.baseFolderId).toBeNull();
    expect(args.userId).toBe('user-1');
    expect(onStarted).toHaveBeenCalledTimes(1);
  });

  it('imports into the folder it was given', async () => {
    renderPanel({ defaultFolderId: 'folder-9', defaultFolderName: 'Projects' });
    pick(holiday());
    expect(screen.getByText('Projects')).toBeTruthy();

    await act(async () => {
      importButton().click();
    });

    await waitFor(() => expect(buildLocalImportSteps).toHaveBeenCalled());
    expect((buildLocalImportSteps.mock.calls[0][0] as { baseFolderId: string | null }).baseFolderId).toBe('folder-9');
  });

  it('starts nothing, and says so, without an unlocked key', async () => {
    canEncryptFor.mockResolvedValue(false);
    const onStarted = vi.fn();
    renderPanel({ onStarted });
    pick(holiday());

    await act(async () => {
      importButton().click();
    });

    await waitFor(() => expect(screen.getByText(/files are never uploaded unencrypted/)).toBeTruthy());
    expect(buildLocalImportSteps).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe').textContent).toBe('idle:none');
    expect(onStarted).not.toHaveBeenCalled();
  });
});

describe('LocalImport — the Takeout card', () => {
  it('offers the Google import by default', () => {
    renderPanel();
    expect(screen.getByText('From Google')).toBeTruthy();
  });

  it('hides it with showTakeout={false}', () => {
    renderPanel({ showTakeout: false });
    expect(screen.queryByText('From Google')).toBeNull();
    expect(screen.getByText('From this computer')).toBeTruthy();
  });
});
