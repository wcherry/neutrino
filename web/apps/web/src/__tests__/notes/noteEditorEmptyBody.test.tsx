/**
 * An encrypted note whose body has never been written still opens.
 *
 * `createNote` inserts the Drive row and nothing else, so the row's
 * `storage_path` is empty until the first save and the download endpoint
 * answers it with 409 `NO_CONTENT`. The editor's decrypted read used
 * `storageApi.downloadFile`, which throws on that — and a 4xx is not retried,
 * so the read stayed in error for the life of the page: no content ever
 * arrived, the editor seeded no blocks, and the note rendered as an empty pane
 * with nothing to type into.
 *
 * Reaching the decrypted branch for a body-less note is a race, which is why
 * this only bit sometimes: `isNewEncryption` ("this session minted the key, so
 * the body is not sealed yet") is read off the render that built the read's
 * closure, and it is still false when the key is minted while that read is
 * being set up — `awaitDek` then hands back a key a moment later and the
 * decrypted branch runs against a body that does not exist.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const NOTE_ID = 'note-1';

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'id' ? NOTE_ID : null) }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

const getFileInfoMock = vi.fn();
const driveReadBytesMock = vi.fn();
const driveReadContentMock = vi.fn();

/**
 * The download the pre-fix read went through. Left rejecting the way the server
 * answers a body-less file, so a read that still reaches for it fails the way
 * it did in the browser.
 */
class ApiClientError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const downloadFileMock = vi.fn(() =>
  Promise.reject(new ApiClientError(409, 'NO_CONTENT', 'File has no content')),
);

vi.mock('@neutrino/api-drive', () => ({
  filesystemApi: { updateFile: vi.fn() },
  storageApi: {
    getFileInfo: (...args: unknown[]) => getFileInfoMock(...args),
    downloadFile: (...args: unknown[]) => downloadFileMock(...args),
  },
  driveReadContent: (...args: unknown[]) => driveReadContentMock(...args),
  driveReadBytes: (...args: unknown[]) => driveReadBytesMock(...args),
  driveAutosaveContent: vi.fn(),
  driveAutosaveEncryptedContent: vi.fn(),
  encryptionApi: { getFileKey: vi.fn(() => Promise.resolve(null)) },
  mintFileKey: vi.fn(),
  canEncryptFor: vi.fn(() => Promise.resolve(true)),
  isMissingEncryptionKey: vi.fn(() => false),
}));

vi.mock('@/lib/noteFiles', () => ({
  createNote: vi.fn(),
  listAllNotes: vi.fn(() => Promise.resolve([])),
  extractNoteText: vi.fn((raw: string) => raw),
}));

vi.mock('@neutrino/api-links', () => ({
  linksApi: {
    getBacklinks: vi.fn(() => Promise.resolve({ backlinks: [] })),
    updateLinks: vi.fn(() => Promise.resolve({ backlinks: [] })),
  },
}));

/** A session holding this note's key, with the body not yet known to be sealed. */
vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => ({
    dekRef: { current: new Uint8Array([1, 2, 3]) },
    dekResolved: true,
    isNewEncryption: false,
    awaitDek: async () => new Uint8Array([1, 2, 3]),
    autosave: vi.fn(),
    createVersion: vi.fn(),
    isAutosaving: false,
    isCreatingVersion: false,
    autosaveError: null,
    createVersionError: null,
  }),
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: vi.fn(() => Promise.resolve()),
  decryptFile: vi.fn(() => new Uint8Array()),
  fromBase64url: vi.fn(() => new Uint8Array()),
  isUnlocked: () => true,
}));

vi.mock('@neutrino/ui', () => ({
  Spinner: ({ overlay }: { overlay?: boolean }) => (
    <div data-testid="spinner" data-overlay={overlay} />
  ),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/hooks/useFileSync', () => ({
  useFileSync: () => ({ connected: true, broadcastFileUpdate: vi.fn() }),
}));

const blockEditorProps: Array<Record<string, unknown>> = [];

const MockBlockEditor = React.forwardRef(function MockBlockEditor(
  props: Record<string, unknown>,
  ref: React.Ref<{ selectAll: () => void }>,
) {
  blockEditorProps.push(props);
  React.useImperativeHandle(ref, () => ({ selectAll: vi.fn() }));
  return <div data-testid="block-editor" />;
});

vi.mock('../../app/(apps)/notes/editor/BlockEditor', () => ({
  __esModule: true,
  default: MockBlockEditor,
  // The real thing: an empty body is one empty paragraph, which is what puts
  // the "Start writing…" placeholder on screen.
  parseBlocks: (raw: string) =>
    raw.trim() ? [{ id: 'b1', type: 'paragraph', content: raw }] : [{ id: 'b1', type: 'paragraph', content: '' }],
  serializeBlocks: () => '',
}));

vi.mock('../../app/(apps)/notes/editor/MenuBar', () => ({ HamburgerMenu: () => null }));
vi.mock('../../app/(apps)/notes/editor/page.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

async function renderEditorPage() {
  const { default: NoteEditorPage } = await import('../../app/(apps)/notes/editor/page');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NoteEditorPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  blockEditorProps.length = 0;
  getFileInfoMock.mockResolvedValue({
    id: NOTE_ID,
    name: 'Current Note',
    folderId: null,
    deletedAt: null,
    yourRole: 'owner',
    storagePath: '',
    mimeType: 'application/x-neutrino-note',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    coverThumbnail: null,
    coverThumbnailMimeType: null,
    tags: [],
    encryptedMetadata: null,
    contentVersion: 1,
  });
  // What `driveReadBytes` makes of a 409 `NO_CONTENT`: no bytes.
  driveReadBytesMock.mockResolvedValue(new Uint8Array(0));
  driveReadContentMock.mockResolvedValue('');
});

describe('Note editor — a note whose body was never written', () => {
  it('seeds an empty block instead of leaving the editor with nothing to type into', async () => {
    await renderEditorPage();

    await waitFor(() => {
      const latest = blockEditorProps[blockEditorProps.length - 1] as { blocks: unknown[] };
      expect(latest?.blocks).toHaveLength(1);
    });
  });

  it('reads the body through the no-content-tolerant helper', async () => {
    await renderEditorPage();

    await waitFor(() => expect(driveReadBytesMock).toHaveBeenCalledWith(NOTE_ID));
    // `downloadFile` rejects on a body-less note, which is what stranded the read.
    expect(downloadFileMock).not.toHaveBeenCalled();
  });
});
