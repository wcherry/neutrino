/**
 * Unit tests for drive area-wide drag-and-drop (issue #6).
 *
 * Covers:
 *   - Dragging files over the file grid sets the drag-over visual state
 *   - Dragging non-file content (e.g. text) does NOT set drag-over state
 *   - Dragging out of the grid clears the drag-over state
 *   - Dropping files on the grid opens the UploadZone overlay
 *   - Dropping an empty transfer (no files) does NOT open the UploadZone
 *   - UploadZone receives the dropped files via initialFiles prop
 *
 * The `driveAreaDropTarget` flag is no longer consulted — migration 00097
 * enabled it permanently and the page dropped the check — so there is no
 * flag-off behaviour left to cover.
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

vi.mock('@/providers/FeatureFlagsProvider', () => ({
  useFeatureFlags: () => new Proxy({}, { get: () => false }),
  useFeatureFlagsLoaded: () => true,
}));

// Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/drive',
  // No `?q=` — these tests exercise the plain folder listing, not search.
  useSearchParams: () => new URLSearchParams(),
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
    getFolderContents: vi.fn(() =>
      Promise.resolve({ folder: null, folders: [], files: [] })
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
  // The search box re-runs its query when the vault unlocks, so the hook behind
  // it subscribes to lock state on mount.
  subscribeToLockState: vi.fn(() => () => {}),
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
  // The grid *is* the drop target: the page hands it the drag handlers and the
  // drag-over flag, and it owns the highlighted state.
  FileGrid: ({
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    isDraggingOver,
  }: {
    onDragEnter?: React.DragEventHandler<HTMLDivElement>;
    onDragOver?: React.DragEventHandler<HTMLDivElement>;
    onDragLeave?: React.DragEventHandler<HTMLDivElement>;
    onDrop?: React.DragEventHandler<HTMLDivElement>;
    isDraggingOver?: boolean;
  }) => (
    <div
      data-testid="file-grid"
      data-dragging-over={isDraggingOver ? 'true' : 'false'}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    />
  ),
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
});

/** The drop target is the file grid, not the page wrapper. */
function grid(): HTMLElement {
  return screen.getByTestId('file-grid');
}

describe('Drive area drag-and-drop', () => {
  it('marks the grid as drag-over when files are dragged over it', async () => {
    await renderDrivePage();

    fireEvent.dragEnter(grid(), makeDragEvent([new File([''], 'test.txt')]));
    fireEvent.dragOver(grid(), makeDragEvent([new File([''], 'test.txt')]));

    expect(grid().dataset.draggingOver).toBe('true');
  });

  it('clears the drag-over state when the drag leaves the grid', async () => {
    await renderDrivePage();

    fireEvent.dragEnter(grid(), makeDragEvent([new File([''], 'test.txt')]));
    fireEvent.dragLeave(grid(), makeDragEvent([]));

    expect(grid().dataset.draggingOver).toBe('false');
  });

  it('opens the UploadZone when files are dropped on the grid', async () => {
    await renderDrivePage();

    fireEvent.dragEnter(grid(), makeDragEvent([new File([''], 'test.txt')]));
    fireEvent.drop(grid(), makeDragEvent([new File([''], 'test.txt')]));

    expect(screen.getByTestId('upload-zone')).toBeInTheDocument();
  });

  it('passes dropped files to UploadZone via initialFiles', async () => {
    await renderDrivePage();
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });

    fireEvent.dragEnter(grid(), makeDragEvent([file]));
    fireEvent.drop(grid(), makeDragEvent([file]));

    expect(uploadZoneInitialFiles.length).toBeGreaterThan(0);
    expect(uploadZoneInitialFiles[0]).toEqual([file]);
  });

  it('does NOT open UploadZone when the drop has no files', async () => {
    await renderDrivePage();

    fireEvent.dragEnter(grid(), makeDragEvent([]));
    fireEvent.drop(grid(), makeDragEvent([]));

    expect(screen.queryByTestId('upload-zone')).not.toBeInTheDocument();
  });

  it('does NOT apply drag-over state when non-file content is dragged over', async () => {
    await renderDrivePage();

    // Simulate a text-drag (no Files type)
    fireEvent.dragEnter(grid(), makeDragEvent([]));

    expect(grid().dataset.draggingOver).toBe('false');
  });

  it('clears drag-over state after a successful drop', async () => {
    await renderDrivePage();
    const file = new File([''], 'file.txt');

    fireEvent.dragEnter(grid(), makeDragEvent([file]));
    fireEvent.drop(grid(), makeDragEvent([file]));

    expect(grid().dataset.draggingOver).toBe('false');
  });
});
