/**
 * Tests for the Note Editor's live-update behaviour: a note edited elsewhere
 * (another user, or the same user on another device) must appear in the open
 * editor without a manual refresh.
 *
 * Covers:
 *   - A remote update signal re-reads the note and swaps in the new content
 *     and title.
 *   - Unsaved local edits are never clobbered by an incoming remote update.
 *   - A local save broadcasts so other viewers re-read the note.
 *   - The note metadata query polls as a fallback while the socket is down,
 *     and does not poll while it is connected.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the module under test is imported
// ---------------------------------------------------------------------------

const NOTE_ID = 'note-1';

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'id' ? NOTE_ID : null) }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

const getFileInfoMock = vi.fn();
const updateFileMock = vi.fn();
const driveReadContentMock = vi.fn();
const driveAutosaveContentMock = vi.fn();

vi.mock('@neutrino/api-drive', () => ({
  filesystemApi: {
    updateFile: (...args: unknown[]) => updateFileMock(...args),
  },
  storageApi: {
    getFileInfo: (...args: unknown[]) => getFileInfoMock(...args),
    downloadFile: vi.fn(),
  },
  driveReadContent: (...args: unknown[]) => driveReadContentMock(...args),
  driveAutosaveContent: (...args: unknown[]) => driveAutosaveContentMock(...args),
  driveAutosaveEncryptedContent: vi.fn(),
}));

const listAllNotesMock = vi.fn();

vi.mock('@/lib/noteFiles', () => ({
  listAllNotes: (...args: unknown[]) => listAllNotesMock(...args),
  extractNoteText: (raw: string) => raw,
}));

const getBacklinksMock = vi.fn();
const updateLinksMock = vi.fn();

vi.mock('@neutrino/api-links', () => ({
  linksApi: {
    getBacklinks: (...args: unknown[]) => getBacklinksMock(...args),
    updateLinks: (...args: unknown[]) => updateLinksMock(...args),
  },
}));

// Unencrypted path — E2EE is covered by the notes/note-encryption e2e specs.
vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => ({
    dekRef: { current: null },
    dekResolved: true,
    isNewEncryption: false,
    autosave: vi.fn(),
    createVersion: vi.fn(),
    isAutosaving: false,
    isCreatingVersion: false,
    autosaveError: null,
    createVersionError: null,
  }),
}));

// The relay is stubbed so tests can deliver a remote signal directly and
// observe what the editor broadcasts. (The socket itself is covered by
// useFileSync.test.ts.)
const broadcastFileUpdateMock = vi.fn();
let syncConnected = true;
let remoteUpdateRef: { current: (() => void) | null } = { current: null };

vi.mock('@/hooks/useFileSync', () => ({
  useFileSync: ({ onRemoteUpdateRef }: { onRemoteUpdateRef?: { current: (() => void) | null } }) => {
    if (onRemoteUpdateRef) remoteUpdateRef = onRemoteUpdateRef;
    return { connected: syncConnected, broadcastFileUpdate: broadcastFileUpdateMock };
  },
}));

vi.mock('@neutrino/ui', () => ({
  Spinner: ({ overlay }: { overlay?: boolean }) => (
    <div data-testid="spinner" data-overlay={overlay} />
  ),
  // The editor warns through a toast when a save is rejected for being stale
  // (see `useContentVersionGuard`); these tests only need it to exist.
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

// Blocks round-trip through JSON so `serializeBlocks(parseBlocks(x)) === x`,
// which is what the editor's "did this actually change?" comparisons rely on.
const blockEditorProps: Array<Record<string, unknown>> = [];

const MockBlockEditor = React.forwardRef(function MockBlockEditor(
  props: Record<string, unknown>,
  ref: React.Ref<{ selectAll: () => void }>
) {
  blockEditorProps.push(props);
  React.useImperativeHandle(ref, () => ({ selectAll: vi.fn() }));
  return <div data-testid="block-editor" />;
});

vi.mock('../../app/(apps)/notes/editor/BlockEditor', () => ({
  __esModule: true,
  default: MockBlockEditor,
  parseBlocks: (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return [];
    }
  },
  serializeBlocks: (b: unknown) => JSON.stringify(b),
}));

vi.mock('../../app/(apps)/notes/editor/blockEditorHelpers', () => ({
  extractWikiLinkTitles: () => [],
  blocksToMarkdown: () => '',
  blocksToHtml: () => '',
}));

vi.mock('../../app/(apps)/notes/editor/MenuBar', () => ({ HamburgerMenu: () => null }));

vi.mock('../../app/(apps)/notes/editor/page.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONTENT_V1 = JSON.stringify([{ id: 'b1', type: 'text', content: 'first' }]);
const CONTENT_V2 = JSON.stringify([{ id: 'b1', type: 'text', content: 'second' }]);
const LOCAL_EDIT = [{ id: 'b1', type: 'text', content: 'my local edit' }];
const LATER_LOCAL_EDIT = [{ id: 'b1', type: 'text', content: 'still typing' }];

function noteInfo(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTE_ID,
    name: 'Current Note',
    folderId: null,
    deletedAt: null,
    yourRole: 'owner',
    storagePath: '/some/path',
    mimeType: 'application/x-neutrino-note',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    coverThumbnail: null,
    coverThumbnailMimeType: null,
    tags: [],
    encryptedMetadata: null,
    contentVersion: 1,
    ...overrides,
  };
}

function autosaveMeta(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTE_ID,
    name: 'Current Note',
    updatedAt: '2026-01-01T00:05:00Z',
    contentVersion: 2,
    ...overrides,
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

async function renderEditorPage() {
  const { default: NoteEditorPage } = await import('../../app/(apps)/notes/editor/page');
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <NoteEditorPage />
    </QueryClientProvider>
  );
}

function latestProps() {
  return blockEditorProps[blockEditorProps.length - 1] as {
    blocks: Array<Record<string, unknown>>;
    onChange: (blocks: unknown) => void;
  };
}

/** Wait until the editor has been seeded with the initial server content. */
async function waitForInitialLoad() {
  await waitFor(() => expect(latestProps().blocks).toEqual(JSON.parse(CONTENT_V1)));
}

/**
 * Flush pending queries/effects under fake timers. RTL's `waitFor` drives its
 * own timer loop, so the fake-timer tests below step the clock by hand instead.
 */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  }
}

/** Deliver a "this note changed" signal from a peer. */
async function deliverRemoteSignal() {
  await act(async () => {
    remoteUpdateRef.current?.();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  blockEditorProps.length = 0;
  syncConnected = true;
  remoteUpdateRef = { current: null };
  listAllNotesMock.mockResolvedValue([]);
  getFileInfoMock.mockResolvedValue(noteInfo());
  driveReadContentMock.mockResolvedValue(CONTENT_V1);
  getBacklinksMock.mockResolvedValue({ backlinks: [] });
  updateLinksMock.mockResolvedValue({ backlinks: [] });
  updateFileMock.mockResolvedValue({});
  driveAutosaveContentMock.mockResolvedValue(autosaveMeta());
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NoteEditorPage — live updates from other users/devices', () => {
  it('shows a remote edit without a manual refresh', async () => {
    await renderEditorPage();
    await waitForInitialLoad();

    // Someone else saves the note.
    getFileInfoMock.mockResolvedValue(
      noteInfo({ name: 'Renamed elsewhere', updatedAt: '2026-01-01T00:10:00Z' })
    );
    driveReadContentMock.mockResolvedValue(CONTENT_V2);

    await deliverRemoteSignal();

    await waitFor(() => expect(latestProps().blocks).toEqual(JSON.parse(CONTENT_V2)));
    await waitFor(() =>
      expect(screen.getByLabelText('Note title')).toHaveValue('Renamed elsewhere')
    );
  });

  it('re-reads the content when a poll reveals a newer revision', async () => {
    await renderEditorPage();
    await waitForInitialLoad();

    const readsAfterLoad = driveReadContentMock.mock.calls.length;

    // No signal — only fresher metadata, as an interval/focus refetch produces.
    getFileInfoMock.mockResolvedValue(noteInfo({ updatedAt: '2026-01-01T00:10:00Z' }));
    driveReadContentMock.mockResolvedValue(CONTENT_V2);

    await act(async () => {
      await Promise.resolve();
    });
    // Force the metadata refetch a poll would perform.
    await deliverRemoteSignal();

    await waitFor(() =>
      expect(driveReadContentMock.mock.calls.length).toBeGreaterThan(readsAfterLoad)
    );
    await waitFor(() => expect(latestProps().blocks).toEqual(JSON.parse(CONTENT_V2)));
  });

  it('does not clobber unsaved local edits', async () => {
    await renderEditorPage();
    await waitForInitialLoad();

    // The user starts typing (autosave is still debouncing).
    act(() => latestProps().onChange(LOCAL_EDIT));
    expect(latestProps().blocks).toEqual(LOCAL_EDIT);

    // A remote edit lands mid-typing.
    getFileInfoMock.mockResolvedValue(noteInfo({ updatedAt: '2026-01-01T00:10:00Z' }));
    driveReadContentMock.mockResolvedValue(CONTENT_V2);

    await deliverRemoteSignal();
    await waitFor(() => expect(driveReadContentMock).toHaveBeenCalledTimes(2));

    // The in-progress edit survives.
    expect(latestProps().blocks).toEqual(LOCAL_EDIT);
  });

  it('broadcasts after a local save so other viewers re-read the note', async () => {
    vi.useFakeTimers();
    await renderEditorPage();
    await settle();
    expect(latestProps().blocks).toEqual(JSON.parse(CONTENT_V1));

    act(() => latestProps().onChange(LOCAL_EDIT));

    // Past the 2 s autosave debounce.
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    await settle();

    expect(driveAutosaveContentMock).toHaveBeenCalledTimes(1);
    expect(broadcastFileUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('keeps keystrokes typed while a save was in flight', async () => {
    vi.useFakeTimers();
    let resolveSave: (meta: unknown) => void = () => {};
    driveAutosaveContentMock.mockImplementation(
      () => new Promise((resolve) => { resolveSave = resolve; })
    );

    await renderEditorPage();
    await settle();

    act(() => latestProps().onChange(LOCAL_EDIT));
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(driveAutosaveContentMock).toHaveBeenCalledTimes(1);

    // The user keeps typing before that save comes back.
    act(() => latestProps().onChange(LATER_LOCAL_EDIT));
    await act(async () => {
      resolveSave(autosaveMeta({ updatedAt: '2026-01-01T00:05:00Z' }));
    });
    await settle();

    // A remote revision lands in the window before the newer keystrokes are saved.
    getFileInfoMock.mockResolvedValue(noteInfo({ updatedAt: '2026-01-01T00:10:00Z' }));
    driveReadContentMock.mockResolvedValue(CONTENT_V2);
    await act(async () => { remoteUpdateRef.current?.(); });
    await settle();

    expect(latestProps().blocks).toEqual(LATER_LOCAL_EDIT);
  });

  it('polls for changes while the socket is down', async () => {
    syncConnected = false;
    vi.useFakeTimers();
    await renderEditorPage();
    await settle();

    const callsAfterLoad = getFileInfoMock.mock.calls.length;
    expect(callsAfterLoad).toBeGreaterThan(0);

    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });

    expect(getFileInfoMock.mock.calls.length).toBeGreaterThan(callsAfterLoad);
  });

  it('does not poll while the socket is connected', async () => {
    vi.useFakeTimers();
    await renderEditorPage();
    await settle();

    const callsAfterLoad = getFileInfoMock.mock.calls.length;
    expect(callsAfterLoad).toBeGreaterThan(0);

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

    expect(getFileInfoMock.mock.calls.length).toBe(callsAfterLoad);
  });
});
