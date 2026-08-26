/**
 * Issue #95, at the place it was reported: the note editor.
 *
 * "Sometimes files get saved unencrypted" was a race, not a rare failure. The
 * save read `dekRef.current` — a ref filled in by an async resolution that
 * starts on mount — and took a plaintext branch when it was still null. Every
 * reload of `/notes/editor` starts that resolution, and any autosave landing
 * before it settles took the plaintext branch. "Sometimes" was "whenever you
 * typed within a second or so of opening the note", and the resulting file had
 * no `file_key_refs` row, so nothing ever came back to encrypt it.
 *
 * The three cases below are the three states the DEK can be in when a save
 * fires: resolved, still resolving, and genuinely absent. Only the first two
 * may write, and both must write ciphertext.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const NOTE_ID = 'note-1';
const DEK = new Uint8Array(32).fill(3);

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'id' ? NOTE_ID : null) }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

const driveAutosaveEncryptedContent = vi.fn();
const mintFileKey = vi.fn();
const canEncryptFor = vi.fn();
const createNote = vi.fn();

vi.mock('@neutrino/api-drive', () => ({
  filesystemApi: { updateFile: vi.fn(() => Promise.resolve({})) },
  storageApi: {
    getFileInfo: vi.fn(() => Promise.resolve(noteInfo())),
    downloadFile: vi.fn(),
  },
  driveReadContent: vi.fn(() => Promise.resolve(CONTENT)),
  // The editor checks for a key ref before it will read raw bytes as note
  // text; these notes are unencrypted, so there is none.
  encryptionApi: { getFileKey: vi.fn(() => Promise.resolve(null)) },
  driveAutosaveEncryptedContent: (...a: unknown[]) => driveAutosaveEncryptedContent(...a),
  mintFileKey: (...a: unknown[]) => mintFileKey(...a),
  canEncryptFor: (...a: unknown[]) => canEncryptFor(...a),
  isMissingEncryptionKey: (err: unknown) => err instanceof Error && err.message === 'no-dek',
}));

vi.mock('@/lib/noteFiles', () => ({
  listAllNotes: vi.fn(() => Promise.resolve([])),
  extractNoteText: (raw: string) => raw,
  createNote: (...a: unknown[]) => createNote(...a),
}));

vi.mock('@neutrino/api-links', () => ({
  linksApi: {
    getBacklinks: vi.fn(() => Promise.resolve({ backlinks: [] })),
    updateLinks: vi.fn(() => Promise.resolve({ backlinks: [] })),
  },
}));

vi.mock('@neutrino/auth', () => ({ useUser: () => ({ id: 'user-1' }) }));

/**
 * The DEK's resolution state, driven per test.
 *
 * `dekRef.current` and `awaitDek()` are deliberately allowed to disagree: that
 * disagreement *is* the bug. `dekRef` reports what is known this instant;
 * `awaitDek` waits for the resolution to settle first. A save that reads the
 * ref is reading a value that has not arrived yet.
 */
let dekNow: Uint8Array | null = DEK;
let dekAfterResolving: Uint8Array | null = DEK;

vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => ({
    dekRef: { get current() { return dekNow; } },
    dekResolved: true,
    isNewEncryption: true,
    awaitDek: () => Promise.resolve(dekAfterResolving),
    autosave: vi.fn(),
    createVersion: vi.fn(),
    isAutosaving: false,
    isCreatingVersion: false,
    autosaveError: null,
    createVersionError: null,
  }),
}));

const toastWarning = vi.fn();
vi.mock('@neutrino/ui', () => ({
  Spinner: () => <div data-testid="spinner" />,
  useToast: () => ({
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: toastWarning,
  }),
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
  parseBlocks: (s: string) => { try { return JSON.parse(s); } catch { return []; } },
  serializeBlocks: (b: unknown) => JSON.stringify(b),
}));

vi.mock('../../app/(apps)/notes/editor/blockEditorHelpers', () => ({
  extractWikiLinkTitles: () => [],
  blocksToMarkdown: () => '',
  blocksToHtml: () => '',
}));

/** Captures the menu's Duplicate handler so the test can invoke it. */
let onDuplicate: () => Promise<void> = async () => {};
vi.mock('../../app/(apps)/notes/editor/MenuBar', () => ({
  HamburgerMenu: (props: { onDuplicate: () => Promise<void> }) => {
    onDuplicate = props.onDuplicate;
    return null;
  },
}));

vi.mock('../../app/(apps)/notes/editor/page.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONTENT = JSON.stringify([{ id: 'b1', type: 'text', content: 'first' }]);
const EDIT = [{ id: 'b1', type: 'text', content: 'typed right after opening' }];

function noteInfo() {
  return {
    id: NOTE_ID,
    name: 'Current Note',
    folderId: null,
    deletedAt: null,
    yourRole: 'owner',
    storagePath: '/p',
    mimeType: 'application/x-neutrino-note',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    coverThumbnail: null,
    coverThumbnailMimeType: null,
    tags: [],
    encryptedMetadata: null,
    contentVersion: 1,
  };
}

async function renderEditor() {
  const { default: NoteEditorPage } = await import('../../app/(apps)/notes/editor/page');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NoteEditorPage />
    </QueryClientProvider>,
  );
}

function latest() {
  return blockEditorProps[blockEditorProps.length - 1] as {
    blocks: unknown[];
    onChange: (blocks: unknown) => void;
  };
}

/** Flush pending queries and effects under fake timers. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  }
}

/** Type an edit and run past the 2 s autosave debounce. */
async function typeAndAutosave() {
  act(() => latest().onChange(EDIT));
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  blockEditorProps.length = 0;
  dekNow = DEK;
  dekAfterResolving = DEK;
  driveAutosaveEncryptedContent.mockResolvedValue({
    id: NOTE_ID, name: 'Current Note', updatedAt: '2026-01-01T00:05:00Z', contentVersion: 2,
  });
  createNote.mockResolvedValue({ id: 'note-copy' });
  mintFileKey.mockResolvedValue(DEK);
  canEncryptFor.mockResolvedValue(true);
});

afterEach(() => { vi.useRealTimers(); });

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

describe('note autosave never writes plaintext', () => {
  it('encrypts with the resolved key in the ordinary case', async () => {
    vi.useFakeTimers();
    await renderEditor();
    await settle();

    await typeAndAutosave();

    // Two writes, and the first is not the edit: these notes are stored in the
    // clear (`getFileKey` returns none), so opening one seals the body it read
    // before the user has typed anything. The edit is the write after it.
    expect(driveAutosaveEncryptedContent).toHaveBeenCalledTimes(2);
    const [noteId, content, filename, dek] = driveAutosaveEncryptedContent.mock.calls.at(-1)!;
    expect(noteId).toBe(NOTE_ID);
    expect(filename).toBe('note.json');
    expect(dek).toBe(DEK);
    // The helper does the encrypting, so what it is handed is plaintext.
    expect(JSON.parse(content as string)).toEqual(EDIT);
    // The seal wrote the note as it was loaded, through the same encrypted path.
    expect(JSON.parse(driveAutosaveEncryptedContent.mock.calls[0][1] as string))
      .toEqual(JSON.parse(CONTENT));
    expect(driveAutosaveEncryptedContent.mock.calls[0][3]).toBe(DEK);
  });

  /**
   * The regression test for issue #95 proper.
   *
   * The key has not landed in the ref yet — exactly the state a page reload
   * leaves the editor in for the first second or so. The old code read the ref,
   * saw null, and wrote the note in the clear. Waiting for the resolution finds
   * the key that was on its way the whole time.
   */
  it('waits for a key still resolving instead of writing in the clear', async () => {
    vi.useFakeTimers();
    dekNow = null;              // the ref, mid-resolution
    dekAfterResolving = DEK;    // what the resolution is about to produce

    await renderEditor();
    await settle();
    await typeAndAutosave();

    // The load's sealing write, then the edit — both with the key the
    // resolution was on its way to producing, neither in the clear.
    expect(driveAutosaveEncryptedContent).toHaveBeenCalledTimes(2);
    for (const call of driveAutosaveEncryptedContent.mock.calls) expect(call[3]).toBe(DEK);
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it('declines to save at all when the vault is genuinely locked', async () => {
    vi.useFakeTimers();
    dekNow = null;
    dekAfterResolving = null;

    await renderEditor();
    await settle();
    await typeAndAutosave();

    expect(driveAutosaveEncryptedContent).not.toHaveBeenCalled();
    // Said so, rather than failing silently — the note is still in the editor,
    // so unlocking and typing again saves it with nothing lost.
    expect(toastWarning).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

describe('duplicating a note never writes plaintext', () => {
  it('mints a key for the copy and writes the body encrypted', async () => {
    await renderEditor();
    await waitFor(() => expect(latest().blocks).toEqual(JSON.parse(CONTENT)));

    await act(async () => { await onDuplicate(); });

    // The copy is a new Drive row with no key of its own; without this it has
    // no key ref and nothing ever encrypts it.
    expect(mintFileKey).toHaveBeenCalledWith('user-1', 'note-copy');
    // Picked by id, not by position: opening the original seals it first, since
    // these notes are stored in the clear.
    const copyWrite = driveAutosaveEncryptedContent.mock.calls.find((c) => c[0] === 'note-copy');
    expect(copyWrite).toBeDefined();
    expect(copyWrite![3]).toBe(DEK);
  });

  it('creates nothing at all when the vault is locked', async () => {
    canEncryptFor.mockResolvedValue(false);
    await renderEditor();
    await waitFor(() => expect(latest().blocks).toEqual(JSON.parse(CONTENT)));

    await act(async () => { await onDuplicate(); });

    // Checked before the note exists, so a locked vault does not leave an empty
    // "(copy)" stranded in Drive for the user to clean up. Writes against the
    // original are not this test's subject — `canEncryptFor` is what stands in
    // for the lock here, and it gates the duplicate alone.
    expect(createNote).not.toHaveBeenCalled();
    expect(driveAutosaveEncryptedContent.mock.calls.some((c) => c[0] === 'note-copy')).toBe(false);
    expect(toastWarning).toHaveBeenCalled();
  });
});
