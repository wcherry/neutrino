/**
 * The import page (`app/(apps)/import/page.tsx`).
 *
 * The conversions and the four runners have their own tests; what this covers
 * is the page's job of putting several products in one run — which of them
 * take part, that one progress bar counts them all, that stopping one stops
 * the rest, and that the result screen adds the summaries up.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImportRunProvider } from '@/components/ImportRun';

const { pushMock, takeout } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  takeout: {
    openTakeout: vi.fn(),
    findKeepNotes: vi.fn(),
    findDriveDocs: vi.fn(),
    findDriveSheets: vi.fn(),
    findTakeoutPhotos: vi.fn(),
    runKeepImport: vi.fn(),
    runDocsImport: vi.fn(),
    runSheetsImport: vi.fn(),
    runPhotosImport: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn(), replace: vi.fn() }),
  // The provider hides its floating indicator on /import itself.
  usePathname: () => '/import',
}));

vi.mock('@neutrino/auth', () => ({ useUser: () => ({ id: 'user-1' }) }));

vi.mock('@/lib/takeout', () => ({
  ...takeout,
  TakeoutError: class TakeoutError extends Error {},
  DEFAULT_KEEP_IMPORT_OPTIONS: {
    includeArchived: true,
    includeTrashed: false,
    skipExisting: true,
    folderName: 'Google Keep',
  },
  DEFAULT_DOCS_IMPORT_OPTIONS: { preserveFolders: true, skipExisting: true, folderName: 'Google Docs' },
  DEFAULT_SHEETS_IMPORT_OPTIONS: {
    preserveFolders: true,
    skipExisting: true,
    folderName: 'Google Sheets',
    importFormulas: true,
  },
  DEFAULT_PHOTOS_IMPORT_OPTIONS: {
    importAlbums: true,
    includeArchived: true,
    includeTrashed: false,
    skipExisting: true,
    folderName: 'Google Photos',
  },
}));

import ImportPage from '@/app/(apps)/import/page';

const summary = (imported: number, extra = {}) => ({
  total: imported,
  imported,
  skipped: 0,
  failed: 0,
  items: [],
  folderId: null,
  cancelled: false,
  unencrypted: false,
  ...extra,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      {/* The run lives above the route in the real app, so the page is tested
          the way it is mounted — without the provider it has nothing to run in. */}
      <ImportRunProvider>
        <ImportPage />
      </ImportRunProvider>
    </QueryClientProvider>,
  );
}

/** Hand the page an archive and wait for the configure stage. */
async function dropArchive(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['zip'], 'takeout.zip', { type: 'application/zip' });
  Object.defineProperty(input, 'files', { value: [file] });
  await act(async () => {
    fireEvent.change(input);
  });
}

const closeArchive = vi.fn().mockResolvedValue(undefined);
const archive = {
  root: 'Takeout/',
  products: [{ name: 'Keep' }, { name: 'Drive' }],
  product: () => undefined,
  close: closeArchive,
};
const keepSource = { directory: 'Keep', entries: [{ path: 'a.json' }, { path: 'b.json' }] };
const docsSource = {
  directory: 'Drive',
  docs: [{ entry: { path: 'a.docx' } }, { entry: { path: 'b.docx' } }],
  unsupported: [],
};
const photosSource = {
  directory: 'Google Photos',
  photos: [
    { entry: { path: 'a.jpg' }, kind: 'image' },
    { entry: { path: 'b.jpg' }, kind: 'image' },
  ],
  albums: [{ folder: 'Rome', title: 'Rome', count: 1 }],
  duplicates: 0,
};
const sheetsSource = {
  directory: 'Drive',
  sheets: [{ entry: { path: 'a.xlsx' } }, { entry: { path: 'b.xlsx' } }],
  unsupported: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  takeout.openTakeout.mockResolvedValue(archive);
  takeout.findKeepNotes.mockResolvedValue(keepSource);
  takeout.findDriveDocs.mockReturnValue(docsSource);
  // Off by default so each test opts into the products it is about; the
  // spreadsheet and photo cases below turn them on.
  takeout.findDriveSheets.mockReturnValue(null);
  takeout.findTakeoutPhotos.mockResolvedValue(null);
  takeout.runKeepImport.mockResolvedValue(summary(2));
  takeout.runDocsImport.mockResolvedValue(summary(2));
  takeout.runSheetsImport.mockResolvedValue(summary(2));
  takeout.runPhotosImport.mockResolvedValue(summary(2));
});

describe('ImportPage', () => {
  it('lists both products it found and imports both', async () => {
    const { container } = renderPage();
    await dropArchive(container);

    expect(screen.getByText('2 notes in Keep')).toBeTruthy();
    expect(screen.getByText('2 documents in Drive')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Import 4 items' }));
    });

    expect(takeout.runKeepImport).toHaveBeenCalledTimes(1);
    expect(takeout.runDocsImport).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText(/4 imported/)).toBeTruthy());
  });

  it('leaves out a product the user unchecked', async () => {
    const { container } = renderPage();
    await dropArchive(container);

    // Each product row has its own "Import" checkbox; the second is Docs.
    const toggles = screen.getAllByLabelText('Import');
    await act(async () => {
      fireEvent.click(toggles[1]);
    });

    expect(screen.getByRole('button', { name: 'Import 2 items' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Import 2 items' }));
    });

    expect(takeout.runKeepImport).toHaveBeenCalledTimes(1);
    expect(takeout.runDocsImport).not.toHaveBeenCalled();
  });

  it('counts the notes already done in the documents run’s progress', async () => {
    let release: () => void = () => {};
    takeout.runDocsImport.mockImplementation(
      ({ onProgress }: { onProgress: (p: unknown) => void }) =>
        new Promise((resolve) => {
          onProgress({ done: 1, total: 2, current: 'a.docx' });
          release = () => resolve(summary(2));
        }),
    );

    const { container } = renderPage();
    await dropArchive(container);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Import 4 items' }));
    });

    // Two notes are already done, so the first document is the third of four.
    expect(screen.getByText('Importing 3 of 4')).toBeTruthy();
    await act(async () => {
      release();
    });
  });

  it('does not start the documents when the notes run was stopped', async () => {
    takeout.runKeepImport.mockResolvedValue(summary(1, { cancelled: true }));
    const { container } = renderPage();
    await dropArchive(container);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Import 4 items' }));
    });

    expect(takeout.runDocsImport).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Import stopped')).toBeTruthy());
  });

  it('adds the two summaries together and offers both destinations', async () => {
    takeout.runKeepImport.mockResolvedValue(
      summary(1, { skipped: 1, items: [{ file: 'b.json', title: 'B', status: 'skipped', reason: 'Archived in Keep' }] }),
    );
    takeout.runDocsImport.mockResolvedValue(
      summary(1, { failed: 1, items: [{ file: 'b.docx', title: 'B', status: 'failed', reason: 'not a docx' }] }),
    );

    const { container } = renderPage();
    await dropArchive(container);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Import 4 items' }));
    });

    await waitFor(() => expect(screen.getByText('2 imported · 1 skipped · 1 failed')).toBeTruthy());
    expect(screen.getByText('not a docx')).toBeTruthy();
    expect(screen.getByText('Skipped (1)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to Notes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to Docs' })).toBeTruthy();
  });

  it('runs the spreadsheets after the notes and the documents', async () => {
    takeout.findDriveSheets.mockReturnValue(sheetsSource);
    const { container } = renderPage();
    await dropArchive(container);

    expect(screen.getByText('2 spreadsheets in Drive')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Import 6 items' }));
    });

    expect(takeout.runSheetsImport).toHaveBeenCalledTimes(1);
    expect(takeout.runDocsImport.mock.invocationCallOrder[0]).toBeLessThan(
      takeout.runSheetsImport.mock.invocationCallOrder[0],
    );
    await waitFor(() => expect(screen.getByText(/6 imported/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Go to Sheets' })).toBeTruthy();
  });

  it('counts the earlier products in the spreadsheets run’s progress', async () => {
    takeout.findDriveSheets.mockReturnValue(sheetsSource);
    let release: () => void = () => {};
    takeout.runSheetsImport.mockImplementation(
      ({ onProgress }: { onProgress: (p: unknown) => void }) =>
        new Promise((resolve) => {
          onProgress({ done: 1, total: 2, current: 'a.xlsx' });
          release = () => resolve(summary(2));
        }),
    );

    const { container } = renderPage();
    await dropArchive(container);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Import 6 items' }));
    });

    // Two notes and two documents are already done, so the first spreadsheet
    // is the fifth of six.
    expect(screen.getByText('Importing 5 of 6')).toBeTruthy();
    await act(async () => {
      release();
    });
  });

  it('does not start the spreadsheets when an earlier run was stopped', async () => {
    takeout.findDriveSheets.mockReturnValue(sheetsSource);
    takeout.runDocsImport.mockResolvedValue(summary(1, { cancelled: true }));
    const { container } = renderPage();
    await dropArchive(container);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Import 6 items' }));
    });

    expect(takeout.runSheetsImport).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Import stopped')).toBeTruthy());
  });

  it('leaves the spreadsheets out when the user unchecks them', async () => {
    takeout.findDriveSheets.mockReturnValue(sheetsSource);
    const { container } = renderPage();
    await dropArchive(container);

    // Each product row has its own "Import" checkbox; the third is Sheets.
    await act(async () => {
      fireEvent.click(screen.getAllByLabelText('Import')[2]);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Import 4 items' }));
    });
    expect(takeout.runSheetsImport).not.toHaveBeenCalled();
  });

  it('runs the photos last of all and offers Photos as a destination', async () => {
    takeout.findTakeoutPhotos.mockResolvedValue(photosSource);
    const { container } = renderPage();
    await dropArchive(container);

    expect(screen.getByText('2 photos in Google Photos')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Import 6 items' }));
    });

    expect(takeout.runPhotosImport).toHaveBeenCalledTimes(1);
    expect(takeout.runDocsImport.mock.invocationCallOrder[0]).toBeLessThan(
      takeout.runPhotosImport.mock.invocationCallOrder[0],
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Go to Photos' })).toBeTruthy());
  });

  it('counts the earlier products in the photos run’s progress', async () => {
    takeout.findTakeoutPhotos.mockResolvedValue(photosSource);
    let release: () => void = () => {};
    takeout.runPhotosImport.mockImplementation(
      ({ onProgress }: { onProgress: (p: unknown) => void }) =>
        new Promise((resolve) => {
          onProgress({ done: 1, total: 2, current: 'a.jpg' });
          release = () => resolve(summary(2));
        }),
    );

    const { container } = renderPage();
    await dropArchive(container);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Import 6 items' }));
    });

    // Two notes and two documents are already done, so the first photo is the
    // fifth of six.
    expect(screen.getByText('Importing 5 of 6')).toBeTruthy();
    await act(async () => {
      release();
    });
  });

  it('imports a Photos-only archive on its own', async () => {
    takeout.findKeepNotes.mockResolvedValue(null);
    takeout.findDriveDocs.mockReturnValue(null);
    takeout.findTakeoutPhotos.mockResolvedValue(photosSource);

    const { container } = renderPage();
    await dropArchive(container);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Import 2 items' }));
    });

    expect(takeout.runPhotosImport).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Go to Photos' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Go to Notes' })).toBeNull();
  });

  it('shows only the documents section for a Drive-only archive', async () => {
    takeout.findKeepNotes.mockResolvedValue(null);
    const { container } = renderPage();
    await dropArchive(container);

    expect(screen.queryByText(/notes in/)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Import 2 items' }));
    });

    expect(takeout.runKeepImport).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Go to Docs' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Go to Notes' })).toBeNull();
  });

  it('releases the zip reader when the archive is dropped or the page goes away', async () => {
    // The reader holds the file handle and a worker pool for as long as it is
    // open, so nothing should keep one alive past the archive it belongs to.
    const { container, unmount } = renderPage();
    await dropArchive(container);
    expect(closeArchive).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Choose a different archive'));
    });
    expect(closeArchive).toHaveBeenCalledTimes(1);

    await dropArchive(container);
    unmount();
    expect(closeArchive).toHaveBeenCalledTimes(2);
  });

  it('says what it found nothing to import in', async () => {
    takeout.findKeepNotes.mockResolvedValue(null);
    takeout.findDriveDocs.mockReturnValue(null);
    const { container } = renderPage();
    await dropArchive(container);

    expect(screen.getByText(/Nothing importable was found/)).toBeTruthy();
  });

  it('warns about documents in a format it cannot convert', async () => {
    takeout.findDriveDocs.mockReturnValue({
      ...docsSource,
      unsupported: [
        { path: 'a.pdf', format: 'PDF' },
        { path: 'b.pdf', format: 'PDF' },
      ],
    });
    const { container } = renderPage();
    await dropArchive(container);

    expect(screen.getByText(/2 files in Drive \(PDF\) cannot be converted/)).toBeTruthy();
  });
});
