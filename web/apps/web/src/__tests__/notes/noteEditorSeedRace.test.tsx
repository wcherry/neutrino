/**
 * Renaming a note the moment it opens must not be undone by its own load.
 *
 * The body read is asynchronous and typing is not, so a note opened and renamed
 * straight away is still waiting for its content when the rename is made. The
 * first seed applied the server's name and body unconditionally, which put the
 * old name back over the new one — and worse than losing it on screen, the save
 * that followed compared the title against the server's, found it unchanged,
 * and sent no rename at all. The note kept its old name for good.
 *
 * The seed still records what the server holds, because that is the baseline
 * the next save compares against; only the copy on screen is left alone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act, fireEvent, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const NOTE_ID = 'note-1';
const SERVER_TITLE = 'Untitled note';
const TYPED_TITLE = 'Autosave Note Title';

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'id' ? NOTE_ID : null) }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

const updateFile = vi.fn(() => Promise.resolve({}));
const driveAutosaveEncryptedContent = vi.fn(() =>
  Promise.resolve({ id: NOTE_ID, updatedAt: '2026-01-01T00:00:01Z', contentVersion: 2 }),
);

/**
 * The key resolution, as the editor sees it. It starts unresolved — the state
 * the editor is in for the first moments of every page load, with the content
 * query gated off and the toolbar (and title input) already on screen.
 */
let dekResolved = false;
const dekListeners = new Set<() => void>();
function resolveDek() {
  dekResolved = true;
  dekListeners.forEach((l) => l());
}

vi.mock('@neutrino/api-drive', () => ({
  filesystemApi: { updateFile: (...a: unknown[]) => updateFile(...(a as [])) },
  storageApi: {
    getFileInfo: () =>
      Promise.resolve({
        id: NOTE_ID,
        name: SERVER_TITLE,
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
      }),
    downloadFile: vi.fn(),
  },
  driveReadContent: () => Promise.resolve(''),
  driveReadBytes: vi.fn(() => Promise.resolve(new Uint8Array(0))),
  encryptionApi: { getFileKey: vi.fn(() => Promise.resolve(null)) },
  driveAutosaveEncryptedContent: (...a: unknown[]) => driveAutosaveEncryptedContent(...(a as [])),
  mintFileKey: vi.fn(),
  canEncryptFor: vi.fn(() => Promise.resolve(true)),
  isMissingEncryptionKey: () => false,
}));

vi.mock('@/lib/noteFiles', () => ({
  createNote: vi.fn(),
  listAllNotes: vi.fn(() => Promise.resolve([])),
  extractNoteText: (raw: string) => raw,
}));

vi.mock('@neutrino/api-links', () => ({
  linksApi: {
    getBacklinks: vi.fn(() => Promise.resolve({ backlinks: [] })),
    updateLinks: vi.fn(() => Promise.resolve({ backlinks: [] })),
  },
}));

vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => ({
    dekRef: { current: new Uint8Array([1]) },
    dekResolved: React.useSyncExternalStore(
      (cb: () => void) => { dekListeners.add(cb); return () => dekListeners.delete(cb); },
      () => dekResolved,
      () => dekResolved,
    ),
    isNewEncryption: true,
    awaitDek: async () => new Uint8Array([1]),
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
  decryptFile: vi.fn(),
  fromBase64url: vi.fn(),
  isUnlocked: () => true,
}));

vi.mock('@neutrino/ui', () => ({
  Spinner: () => <div data-testid="spinner" />,
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/hooks/useFileSync', () => ({
  useFileSync: () => ({ connected: true, broadcastFileUpdate: vi.fn() }),
}));

const blockEditorProps: Array<Record<string, unknown>> = [];
function seededBlocks(): unknown[] {
  const latest = blockEditorProps[blockEditorProps.length - 1] as { blocks?: unknown[] } | undefined;
  return latest?.blocks ?? [];
}

vi.mock('../../app/(apps)/notes/editor/BlockEditor', () => ({
  __esModule: true,
  default: React.forwardRef(function MockBlockEditor(
    props: Record<string, unknown>,
    ref: React.Ref<{ selectAll: () => void }>,
  ) {
    blockEditorProps.push(props);
    React.useImperativeHandle(ref, () => ({ selectAll: vi.fn() }));
    return <div data-testid="block-editor" />;
  }),
  parseBlocks: (raw: string) => [{ id: 'b1', type: 'paragraph', content: raw }],
  serializeBlocks: (blocks: Array<{ content: string }>) => JSON.stringify(blocks),
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
  dekResolved = false;
  dekListeners.clear();
  blockEditorProps.length = 0;
});

describe('Note editor — renaming before the body has loaded', () => {
  it('keeps the typed title and still sends the rename', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderEditorPage();

    // The title input is on screen while the body read is still in flight.
    const input = await screen.findByLabelText('Note title');
    fireEvent.change(input, { target: { value: TYPED_TITLE } });
    expect((input as HTMLInputElement).value).toBe(TYPED_TITLE);

    // The key resolves only now — after the rename — which is what lets the
    // content read run and the first seed arrive.
    await act(async () => { resolveDek(); });

    // The typed title survives the seed…
    await waitFor(() => expect((screen.getByLabelText('Note title') as HTMLInputElement).value).toBe(TYPED_TITLE));

    // …and the save that follows renames the file rather than deciding the
    // title never changed.
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    await waitFor(() => expect(updateFile).toHaveBeenCalledWith(NOTE_ID, { name: TYPED_TITLE }));

    vi.useRealTimers();
  });

  it('still seeds the body, which the rename did not touch', async () => {
    // Preserving the typed title must not cost the note its blocks: skipping
    // the seed wholesale left the body with nothing in it, so there was no
    // placeholder to click and no way to start writing.
    const { container } = await renderEditorPage();

    const input = await screen.findByLabelText('Note title');
    fireEvent.change(input, { target: { value: TYPED_TITLE } });

    await act(async () => { resolveDek(); });

    await waitFor(() => expect(container.querySelector('[data-testid="block-editor"]')).toBeTruthy());
    await waitFor(() => expect(seededBlocks()).toHaveLength(1));
  });
});
