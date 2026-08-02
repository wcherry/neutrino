/**
 * Landing pages for the Office Suite apps (issue #66): /docs, /sheets, /slides
 * and /drawing. All four render the shared `DocumentLibrary`, so these tests
 * cover the per-app wiring (which API each page lists, creates, renames and
 * deletes through) plus the library behaviour that differs between them —
 * notably that drawings have no preview.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks — the pages are imported statically below, so everything the factories
// close over has to be created with `vi.hoisted` to exist by then.
// ---------------------------------------------------------------------------

const { pushMock, api, fileGridProps, previewProps } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  api: {
    docsApi: { listDocs: vi.fn(), createDoc: vi.fn(), saveDoc: vi.fn() },
    sheetsApi: { listSheets: vi.fn(), createSheet: vi.fn(), saveSheet: vi.fn() },
    slidesApi: { listSlides: vi.fn(), createSlide: vi.fn(), saveSlide: vi.fn() },
    drawingApi: { listDrawings: vi.fn(), createDrawing: vi.fn(), saveDrawing: vi.fn() },
    storageApi: { deleteFile: vi.fn() },
  },
  fileGridProps: [] as Array<Record<string, unknown>>,
  previewProps: [] as Array<{ id: string; kind: string }>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/lib/api', () => api);

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
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
  FileGrid: (props: Record<string, unknown>) => {
    fileGridProps.push(props);
    return <div data-testid="file-grid" />;
  },
}));

vi.mock('@/components/DocumentPreviewModal', () => ({
  DocumentPreviewModal: (props: { id: string; kind: string }) => {
    previewProps.push(props);
    return <div data-testid="preview" />;
  },
}));

vi.mock('../../app/(apps)/DocumentLibrary.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));
vi.mock('../../app/(apps)/drive/FileContextMenu.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

// Imported after the mocks above only in source order — `vi.mock` is hoisted,
// so these pages see the stubbed API clients and UI components.
import DocsPage from '../../app/(apps)/docs/page';
import SheetsPage from '../../app/(apps)/sheets/page';
import SlidesPage from '../../app/(apps)/slides/page';
import DrawingsPage from '../../app/(apps)/drawing/page';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

function renderPage(Page: React.ComponentType) {
  const qc = makeQueryClient();
  const result = render(
    <QueryClientProvider client={qc}>
      <Page />
    </QueryClientProvider>
  );
  return { ...result, qc };
}

function latestFileGridProps() {
  return fileGridProps[fileGridProps.length - 1] as {
    items: Array<{ id: string; name: string; typeText?: string }>;
    isLoading?: boolean;
    isError?: boolean;
    onItemClick?: (item: { id: string; name: string }) => void;
    onItemMenuOpen?: (item: { id: string; name: string }, e: unknown) => void;
  };
}

function fakeMenuEvent() {
  return {
    currentTarget: { getBoundingClientRect: () => ({ right: 100, bottom: 100 }) },
  } as unknown as React.MouseEvent;
}

function meta(id: string, title: string) {
  return {
    id,
    title,
    folderId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  };
}

/** One row per app: everything that differs between the four landing pages. */
const APPS = [
  {
    name: 'Docs',
    Page: DocsPage,
    heading: 'Documents',
    newLabel: /new document/i,
    typeText: 'Doc',
    editorPath: '/docs/editor',
    queryKey: 'docs',
    previewKind: 'doc',
    client: api.docsApi,
    list: 'listDocs' as const,
    listResponse: (items: unknown[]) => ({ docs: items }),
    create: 'createDoc' as const,
    createArgs: { title: 'Untitled document' },
    rename: 'saveDoc' as const,
  },
  {
    name: 'Sheets',
    Page: SheetsPage,
    heading: 'Spreadsheets',
    newLabel: /new spreadsheet/i,
    typeText: 'Sheet',
    editorPath: '/sheets/editor',
    queryKey: 'sheets',
    previewKind: 'sheet',
    client: api.sheetsApi,
    list: 'listSheets' as const,
    listResponse: (items: unknown[]) => ({ sheets: items }),
    create: 'createSheet' as const,
    createArgs: { title: 'Untitled spreadsheet' },
    rename: 'saveSheet' as const,
  },
  {
    name: 'Slides',
    Page: SlidesPage,
    heading: 'Presentations',
    newLabel: /new presentation/i,
    typeText: 'Slides',
    editorPath: '/slides/editor',
    queryKey: 'slides',
    previewKind: 'slide',
    client: api.slidesApi,
    list: 'listSlides' as const,
    listResponse: (items: unknown[]) => ({ slides: items }),
    create: 'createSlide' as const,
    createArgs: { title: 'Untitled presentation' },
    rename: 'saveSlide' as const,
  },
  {
    name: 'Drawings',
    Page: DrawingsPage,
    heading: 'Drawings',
    newLabel: /new drawing/i,
    typeText: 'Drawing',
    editorPath: '/drawing/editor',
    queryKey: 'drawings',
    previewKind: undefined,
    client: api.drawingApi,
    list: 'listDrawings' as const,
    listResponse: (items: unknown[]) => ({ drawings: items }),
    create: 'createDrawing' as const,
    createArgs: { title: 'Untitled drawing' },
    rename: 'saveDrawing' as const,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  fileGridProps.length = 0;
  previewProps.length = 0;
  api.storageApi.deleteFile.mockResolvedValue(undefined);
  for (const app of APPS) {
    const client = app.client as unknown as Record<string, ReturnType<typeof vi.fn>>;
    client[app.list].mockResolvedValue(app.listResponse([]));
    client[app.create].mockResolvedValue(meta('new-id', 'Untitled'));
    client[app.rename].mockResolvedValue(meta('1', 'Renamed'));
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.each(APPS)('$name landing page', (app) => {
  const client = app.client as unknown as Record<string, ReturnType<typeof vi.fn>>;

  it(`renders the "${app.heading}" heading`, async () => {
    renderPage(app.Page);

    expect(await screen.findByRole('heading', { level: 1, name: app.heading })).toBeTruthy();
  });

  it('lists the current files through its own API', async () => {
    client[app.list].mockResolvedValue(app.listResponse([meta('1', 'First'), meta('2', 'Second')]));

    renderPage(app.Page);

    await waitFor(() => expect(latestFileGridProps().items).toHaveLength(2));

    const items = latestFileGridProps().items;
    expect(items.map((i) => [i.id, i.name])).toEqual([['1', 'First'], ['2', 'Second']]);
    expect(items[0].typeText).toBe(app.typeText);
  });

  it('passes isLoading through while the listing is pending', async () => {
    client[app.list].mockReturnValue(new Promise(() => {}));

    renderPage(app.Page);

    await waitFor(() => expect(fileGridProps.length).toBeGreaterThan(0));
    expect(latestFileGridProps().isLoading).toBe(true);
  });

  it('passes isError through when the listing rejects', async () => {
    client[app.list].mockRejectedValue(new Error('network error'));

    renderPage(app.Page);

    await waitFor(() => expect(latestFileGridProps().isError).toBe(true));
  });

  it('creates a new file and opens it in the editor', async () => {
    renderPage(app.Page);

    fireEvent.click(screen.getByRole('button', { name: app.newLabel }));

    await waitFor(() => expect(client[app.create]).toHaveBeenCalledWith(app.createArgs));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`${app.editorPath}?id=new-id`));
  });

  it('opens an existing file in the editor', async () => {
    client[app.list].mockResolvedValue(app.listResponse([meta('1', 'First')]));

    renderPage(app.Page);
    await waitFor(() => expect(latestFileGridProps().items).toHaveLength(1));

    act(() => {
      latestFileGridProps().onItemClick?.({ id: '1', name: 'First' });
    });

    expect(pushMock).toHaveBeenCalledWith(`${app.editorPath}?id=1`);
  });

  it('renames through its own API and refreshes the listing', async () => {
    const { qc } = renderPage(app.Page);
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    await waitFor(() => expect(fileGridProps.length).toBeGreaterThan(0));
    act(() => {
      latestFileGridProps().onItemMenuOpen?.({ id: '1', name: 'First' }, fakeMenuEvent());
    });

    fireEvent.click(await screen.findByRole('menuitem', { name: /rename/i }));

    const input = screen.getByLabelText(/^new .* name$/i);
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(client[app.rename]).toHaveBeenCalledWith('1', { title: 'Renamed' }));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [app.queryKey] })
    );
  });

  it('deletes through the Drive API and refreshes the listing', async () => {
    const { qc } = renderPage(app.Page);
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    await waitFor(() => expect(fileGridProps.length).toBeGreaterThan(0));
    act(() => {
      latestFileGridProps().onItemMenuOpen?.({ id: '1', name: 'First' }, fakeMenuEvent());
    });

    fireEvent.click(await screen.findByRole('menuitem', { name: /move to trash/i }));

    await waitFor(() => expect(api.storageApi.deleteFile).toHaveBeenCalledWith('1'));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [app.queryKey] })
    );
  });

  it(app.previewKind ? 'previews with its own document kind' : 'offers no preview', async () => {
    renderPage(app.Page);

    await waitFor(() => expect(fileGridProps.length).toBeGreaterThan(0));
    act(() => {
      latestFileGridProps().onItemMenuOpen?.({ id: '1', name: 'First' }, fakeMenuEvent());
    });

    const menu = await screen.findByRole('menu');
    const previewItem = screen.queryByRole('menuitem', { name: /preview/i });

    if (!app.previewKind) {
      expect(previewItem).toBeNull();
      return;
    }

    expect(menu).toBeTruthy();
    fireEvent.click(previewItem!);

    await waitFor(() => expect(previewProps).toHaveLength(1));
    expect(previewProps[0]).toMatchObject({ id: '1', kind: app.previewKind });
  });
});
