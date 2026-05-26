/**
 * Unit tests for drive area-wide drag-and-drop (issue #6).
 *
 * Covers:
 *   - Dragging files over the drive page sets the drag-over visual state
 *   - Dragging non-file content (e.g. text) does NOT set drag-over state
 *   - Dragging out of the drive page clears the drag-over state
 *   - Dropping files on the drive area opens the UploadZone overlay
 *   - Dropping an empty transfer (no files) does NOT open the UploadZone
 *   - UploadZone receives the dropped files via initialFiles prop
 *   - Feature flag off: drag events are ignored (no drag-over state, no upload)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the module under test is imported
// ---------------------------------------------------------------------------

// Track whether UploadZone was rendered and with which initialFiles
const uploadZoneInitialFiles: File[][] = [];
vi.mock('../../app/(apps)/drive/UploadZone', () => ({
  UploadZone: ({ onClose, initialFiles }: { onClose: () => void; initialFiles?: File[] }) => {
    uploadZoneInitialFiles.push(initialFiles ?? []);
    return (
      <div data-testid="upload-zone">
        <button onClick={onClose}>Close</button>
      </div>
    );
  },
}));

// Feature flags — toggled per test
let driveAreaDropTarget = true;
vi.mock('@/lib/featureFlags', () => ({
  default: new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'driveAreaDropTarget') return driveAreaDropTarget;
        return false;
      },
    }
  ),
}));

// Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/drive',
}));

// Auth
vi.mock('@neutrino/auth', () => ({
  useAuth: () => ({ user: null, isLoading: false }),
  useUser: () => null,
}));

// API layer — return empty content so the page renders without errors
vi.mock('@/lib/api', () => ({
  storageApi: {
    uploadFile: vi.fn(),
    deleteFile: vi.fn(),
    downloadFile: vi.fn(),
    getFileDownloadUrl: vi.fn(() => 'https://example.com/file'),
  },
  filesystemApi: {
    getRootContents: vi.fn(() =>
      Promise.resolve({ folder: null, folders: [], files: [], shortcuts: [] })
    ),
    getFolderContents: vi.fn(() =>
      Promise.resolve({ folder: null, folders: [], files: [], shortcuts: [] })
    ),
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

// E2E crypto
vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: vi.fn(),
  generateFileKey: vi.fn(),
  encryptFileKey: vi.fn(),
  encryptMetadata: vi.fn(),
  loadKeyPair: vi.fn(() => null),
}));

// UI package — minimal stubs to avoid CSS module issues in jsdom
vi.mock('@neutrino/ui', () => ({
  Heading: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Card: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <div onClick={onClick}>{children}</div>
  ),
  Breadcrumbs: () => <nav />,
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  Skeleton: () => <div />,
  FileGrid: () => <div data-testid="file-grid" />,
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

// Other drive-page sub-components
vi.mock('../../app/(apps)/drive/PreviewModal', () => ({
  PreviewModal: () => null,
}));
vi.mock('../../app/(apps)/drive/FileContextMenu', () => ({
  FileContextMenu: () => null,
}));
vi.mock('../../app/(apps)/drive/FolderContextMenu', () => ({
  FolderContextMenu: () => null,
}));
vi.mock('../../app/(apps)/drive/FileInfoPanel', () => ({
  FileInfoPanel: () => null,
}));
vi.mock('../../app/(apps)/drive/ShareDialog', () => ({
  ShareDialog: () => null,
}));
vi.mock('../../app/(apps)/drive/MoveFolderDialog', () => ({
  MoveFolderDialog: () => null,
}));
vi.mock('@/components/DocumentPreviewModal', () => ({
  DocumentPreviewModal: () => null,
}));
vi.mock('@/lib/file-icons', () => ({
  getFileIcon: vi.fn(() => 'File'),
  getIconColor: vi.fn(() => '#000'),
}));

// CSS modules
vi.mock('../../app/(apps)/drive/page.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

async function renderDrivePage() {
  // Dynamic import so that vi.mock declarations above take effect first.
  const { default: DrivePage } = await import('../../app/(apps)/drive/page');
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <DrivePage />
    </QueryClientProvider>
  );
}

function makeDragEvent(files: File[]): Partial<React.DragEvent<HTMLDivElement>> {
  const dataTransfer = {
    types: files.length > 0 ? ['Files'] : ['text/plain'],
    files,
    dropEffect: '',
  };
  return {
    preventDefault: vi.fn(),
    dataTransfer: dataTransfer as unknown as DataTransfer,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  uploadZoneInitialFiles.length = 0;
  driveAreaDropTarget = true;
});

describe('Drive area drag-and-drop — feature flag ON', () => {
  it('applies the drag-over CSS class when files are dragged over the page', async () => {
    const { container } = await renderDrivePage();
    const page = container.firstChild as HTMLElement;

    fireEvent.dragEnter(page, makeDragEvent([new File([''], 'test.txt')]));
    fireEvent.dragOver(page, makeDragEvent([new File([''], 'test.txt')]));

    expect(page.className).toContain('page--drag-over');
  });

  it('removes the drag-over CSS class when drag leaves the page', async () => {
    const { container } = await renderDrivePage();
    const page = container.firstChild as HTMLElement;

    // Enter then leave
    fireEvent.dragEnter(page, makeDragEvent([new File([''], 'test.txt')]));
    fireEvent.dragLeave(page, makeDragEvent([]));

    expect(page.className).not.toContain('page--drag-over');
  });

  it('opens the UploadZone when files are dropped on the drive area', async () => {
    const { container } = await renderDrivePage();
    const page = container.firstChild as HTMLElement;

    fireEvent.dragEnter(page, makeDragEvent([new File([''], 'test.txt')]));
    fireEvent.drop(page, makeDragEvent([new File([''], 'test.txt')]));

    expect(screen.getByTestId('upload-zone')).toBeInTheDocument();
  });

  it('passes dropped files to UploadZone via initialFiles', async () => {
    const { container } = await renderDrivePage();
    const page = container.firstChild as HTMLElement;
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });

    fireEvent.dragEnter(page, makeDragEvent([file]));
    fireEvent.drop(page, makeDragEvent([file]));

    expect(uploadZoneInitialFiles.length).toBeGreaterThan(0);
    expect(uploadZoneInitialFiles[0]).toEqual([file]);
  });

  it('does NOT open UploadZone when the drop has no files', async () => {
    const { container } = await renderDrivePage();
    const page = container.firstChild as HTMLElement;

    fireEvent.dragEnter(page, makeDragEvent([]));
    fireEvent.drop(page, makeDragEvent([]));

    expect(screen.queryByTestId('upload-zone')).not.toBeInTheDocument();
  });

  it('does NOT apply drag-over state when non-file content is dragged over', async () => {
    const { container } = await renderDrivePage();
    const page = container.firstChild as HTMLElement;

    // Simulate a text-drag (no Files type)
    fireEvent.dragEnter(page, makeDragEvent([]));

    expect(page.className).not.toContain('page--drag-over');
  });

  it('clears drag-over state after a successful drop', async () => {
    const { container } = await renderDrivePage();
    const page = container.firstChild as HTMLElement;
    const file = new File([''], 'file.txt');

    fireEvent.dragEnter(page, makeDragEvent([file]));
    fireEvent.drop(page, makeDragEvent([file]));

    expect(page.className).not.toContain('page--drag-over');
  });
});

describe('Drive area drag-and-drop — feature flag OFF', () => {
  beforeEach(() => {
    driveAreaDropTarget = false;
  });

  it('does NOT apply drag-over state when the feature flag is off', async () => {
    const { container } = await renderDrivePage();
    const page = container.firstChild as HTMLElement;

    fireEvent.dragEnter(page, makeDragEvent([new File([''], 'test.txt')]));
    fireEvent.dragOver(page, makeDragEvent([new File([''], 'test.txt')]));

    expect(page.className).not.toContain('page--drag-over');
  });

  it('does NOT open UploadZone on drop when the feature flag is off', async () => {
    const { container } = await renderDrivePage();
    const page = container.firstChild as HTMLElement;

    fireEvent.drop(page, makeDragEvent([new File([''], 'test.txt')]));

    expect(screen.queryByTestId('upload-zone')).not.toBeInTheDocument();
  });
});
