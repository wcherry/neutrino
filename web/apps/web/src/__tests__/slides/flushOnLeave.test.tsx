/**
 * Edits made in the last two seconds must survive leaving the editor by any
 * route, not just the in-app back button (issue #12).
 *
 * Autosave is debounced by 2s. `handleBack` cancels the timer and writes before
 * navigating, but it is one button: the browser's back button, a closed or
 * reloaded tab, a typed URL and any other `router.push` all unmount the editor
 * instead, and the unmount cleanup used to only *clear* the timer — so whatever
 * was typed since the last tick was dropped in silence.
 *
 * What replaces it flushes on the three ways out: the tab going hidden,
 * `pagehide`, and the unmount that every in-app navigation ends in. The write
 * asks for `keepalive` so the browser still delivers it once the document is
 * gone, and `beforeunload` is prevented while anything is unsaved, since a
 * keepalive request is capped at 64 KB and a real deck goes over it.
 *
 * Mocking follows `newDeckIsSealed.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Two slides, so that "the stored deck" and "the default deck the editor shows
 * before the content query comes back" are told apart by the slide count alone.
 */
const STORED_DECK = JSON.stringify({
  slides: ['s1', 's2'].map((id) => ({
    id,
    background: { type: 'color', value: '#ffffff' },
    elements: [],
    notes: '',
    transition: 'fade',
  })),
  theme: { name: 'default' },
});

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'id' ? 'deck-id' : null) }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@neutrino/ui', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) =>
    React.createElement('button', { onClick }, children),
  Toolbar: () => null,
  ToolbarGroup: () => null,
  ToolbarDivider: () => null,
  ToolbarButton: () => null,
  ToolbarSelect: () => null,
  ColorPickerPopover: () => null,
  ZoomSlider: () => null,
  ShareButton: () => null,
  HamburgerMenu: () => null,
  Modal: () => null,
  ModalHeader: () => null,
  ModalBody: () => null,
  useToast: () => ({ warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('@neutrino/auth', () => ({
  useUser: () => ({ id: 'user-1', name: 'Tester' }),
  useAuth: () => ({ user: null, isLoading: false }),
}));

const mockAutosaveEncrypted = vi.fn(() => Promise.resolve({ contentVersion: 3 }));
const mockSaveSlide = vi.fn(() => Promise.resolve());

vi.mock('@/lib/api', () => ({
  ApiClientError: class ApiClientError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, code: string, message: string) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
      this.code = code;
    }
  },
  slidesApi: {
    getSlide: vi.fn(() =>
      Promise.resolve({
        id: 'deck-id',
        title: 'Deck',
        contentUrl: '/api/v1/drive/files/deck-id',
        contentWriteUrl: '/api/v1/drive/files/deck-id/versions',
        contentVersion: 2,
      }),
    ),
    listThemes: vi.fn(() => Promise.resolve([])),
    saveSlide: (...args: unknown[]) => mockSaveSlide(...(args as [])),
  },
  driveReadContent: vi.fn(() => Promise.resolve(STORED_DECK)),
  driveAutosaveEncryptedContent: (...args: unknown[]) => mockAutosaveEncrypted(...(args as [])),
  driveAutosaveEncryptedBytes: vi.fn(),
  mintFileKey: vi.fn(),
  canEncryptFor: vi.fn(() => Promise.resolve(true)),
  extractSlideText: vi.fn(() => ''),
  storageApi: {
    getFileMetadata: vi.fn(),
    downloadFile: vi.fn(() => Promise.resolve(new Blob([STORED_DECK]))),
  },
  filesystemApi: { updateFile: vi.fn(() => Promise.resolve()) },
  encryptionApi: { getFileKey: vi.fn(() => Promise.resolve(null)) },
}));

vi.mock('@/lib/searchIndexUpdate', () => ({ indexOnSave: vi.fn() }));

vi.mock('@/app/(apps)/drive/ShareDialog', () => ({ ShareDialog: () => null }));

vi.mock('@/hooks/useSlidePresence', () => ({
  useSlidePresence: () => ({ remoteUsers: [], broadcastPresentation: vi.fn() }),
}));

const dek = new Uint8Array([1, 2, 3, 4]);

vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => ({
    dekRef: { current: dek },
    dekResolved: true,
    isNewEncryption: false,
    awaitDek: async () => dek,
  }),
}));

// The stored deck is sealed, so it decrypts — which keeps the seal-on-open
// write (`newDeckIsSealed.test.tsx`) out of the way of the counts below.
vi.mock('@neutrino/e2e-crypto', () => ({
  decryptFile: vi.fn(() => new TextEncoder().encode(STORED_DECK)),
  isUnlocked: () => true,
}));

vi.mock('@/hooks/useSpellCheck', () => ({ useSpellCheck: () => ({ spellCheck: false }) }));

vi.mock('@neutrino/sheet-embed', () => ({
  useSheetPasteInterceptor: () => ({ handlePaste: vi.fn(), dialogState: null }),
  PasteChoiceDialog: () => null,
}));

vi.mock('../../app/(apps)/slides/editor/InsertSheetDialog', () => ({ InsertSheetDialog: () => null }));
vi.mock('@/components/InsertImageDialog', () => ({ InsertImageDialog: () => null }));
vi.mock('../../app/(apps)/slides/editor/InsertDiagramDialog', () => ({
  InsertDiagramDialog: () => null,
}));
vi.mock('../../app/(apps)/slides/editor/pptxImport', () => ({ importFromPptx: vi.fn() }));
vi.mock('../../app/(apps)/slides/editor/page.module.css', () => ({
  default: new Proxy({}, { get: (_, k) => String(k) }),
}));

import { SlideEditor } from '../../app/(apps)/slides/editor/SlideEditor';

function renderSlideEditor() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(SlideEditor)),
  );
}

/** Open the editor and make one edit, leaving it inside the autosave debounce. */
async function renderAndEdit() {
  const view = renderSlideEditor();
  // Wait for the stored deck, not just for the editor: edit the default deck by
  // mistake and the flush would be writing content the user never had.
  await screen.findByText('Slides (2)');
  fireEvent.click(screen.getByTitle('Add slide'));
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SlideEditor — flushing pending edits on the way out', () => {
  it('writes the pending deck when the editor unmounts', async () => {
    const { unmount } = await renderAndEdit();
    // Still inside the 2s debounce: nothing has been written yet.
    expect(mockAutosaveEncrypted).not.toHaveBeenCalled();

    unmount();

    await waitFor(() => expect(mockAutosaveEncrypted).toHaveBeenCalledTimes(1));
    const [fileId, content, filename, key, , transport] =
      mockAutosaveEncrypted.mock.calls[0] as unknown[];
    expect(fileId).toBe('deck-id');
    expect(filename).toBe('slide.json');
    expect(key).toBe(dek);
    // The edit is in it — three slides, not the two that were loaded.
    expect(JSON.parse(content as string).slides).toHaveLength(3);
    // And it is allowed to outlive the document.
    expect(transport).toEqual({ keepalive: true });
  });

  it('writes on pagehide, and the unmount that follows does not write again', async () => {
    const { unmount } = await renderAndEdit();

    act(() => { window.dispatchEvent(new Event('pagehide')); });
    await waitFor(() => expect(mockAutosaveEncrypted).toHaveBeenCalledTimes(1));

    unmount();
    await new Promise((r) => setTimeout(r, 50));
    expect(mockAutosaveEncrypted).toHaveBeenCalledTimes(1);
  });

  it('writes when the tab is hidden', async () => {
    await renderAndEdit();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    await waitFor(() => expect(mockAutosaveEncrypted).toHaveBeenCalledTimes(1));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('warns before an unload that would lose the edit', async () => {
    await renderAndEdit();

    const event = new Event('beforeunload', { cancelable: true });
    act(() => { window.dispatchEvent(event); });

    expect(event.defaultPrevented).toBe(true);
    // The prompt is the second line of defence: the same handler has already
    // fired the save, and staying on the page is what gives it time to land.
    await waitFor(() => expect(mockAutosaveEncrypted).toHaveBeenCalledTimes(1));
  });

  it('writes nothing — and does not warn — for a deck that was only opened', async () => {
    // The guard that matters: "what is on screen differs from what loaded" is
    // also true while the content query is still in flight, and flushing that
    // would write the empty default deck over the real presentation.
    const { unmount } = renderSlideEditor();
    await screen.findByTitle('Add slide');

    const event = new Event('beforeunload', { cancelable: true });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);

    unmount();
    await new Promise((r) => setTimeout(r, 50));
    expect(mockAutosaveEncrypted).not.toHaveBeenCalled();
  });

  it('saves a title typed inside its own debounce', async () => {
    const { unmount } = renderSlideEditor();
    const titleInput = await screen.findByPlaceholderText('Untitled presentation');

    fireEvent.change(titleInput, { target: { value: 'Renamed deck' } });
    expect(mockSaveSlide).not.toHaveBeenCalled();

    unmount();

    await waitFor(() => expect(mockSaveSlide).toHaveBeenCalledTimes(1));
    expect(mockSaveSlide.mock.calls[0]).toEqual(['deck-id', { title: 'Renamed deck' }]);
  });
});
