/**
 * A newly created presentation must not be left in plaintext on the server.
 *
 * Drive seeds a new deck's body itself from the mime type (`NATIVE_TYPES` in
 * `src/drive/storage/native_types.rs`), so the bytes on disk after creation are
 * readable JSON. The editor is what turns them into ciphertext: once the DEK it
 * minted for the file is ready, it re-saves the body through
 * `driveAutosaveEncryptedContent`.
 *
 * The regression this pins down: that re-save was also gated on "and nothing
 * loaded" (`lastSavedRef.current === ''`), which stopped holding the moment
 * Drive started seeding a body — so a new deck kept its plaintext on the server
 * indefinitely. `sheet-encryption.spec.ts` covers the same property for sheets,
 * where it is tracked as `serverHasPlaintextContent`.
 *
 * Mocking follows `officeMode.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** The body Drive seeds for `application/x-neutrino-slide`, in plaintext. */
const SEEDED_PLAINTEXT_DECK = JSON.stringify({
  slides: [
    {
      id: 's1',
      background: { type: 'color', value: '#ffffff' },
      elements: [
        {
          id: 'e1',
          type: 'text',
          x: 10,
          y: 30,
          w: 80,
          h: 20,
          content: 'Click to add title',
          style: {},
        },
      ],
      notes: '',
      transition: 'fade',
    },
  ],
  theme: { name: 'default' },
});

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'id' ? 'new-deck-id' : null) }),
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
  useUser: () => null,
  useAuth: () => ({ user: null, isLoading: false }),
}));

const mockAutosaveEncrypted = vi.fn(() => Promise.resolve({ contentVersion: 2 }));

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
        id: 'new-deck-id',
        title: 'Untitled presentation',
        contentUrl: '/api/v1/drive/files/new-deck-id',
        contentWriteUrl: '/api/v1/drive/files/new-deck-id/versions',
      }),
    ),
    listThemes: vi.fn(() => Promise.resolve([])),
    autosaveEncryptedContent: vi.fn(() => Promise.resolve()),
    saveSlide: vi.fn(() => Promise.resolve()),
  },
  // The server holds plaintext, so this is what a read comes back with.
  driveReadContent: vi.fn(() => Promise.resolve(SEEDED_PLAINTEXT_DECK)),
  driveAutosaveEncryptedContent: (...args: unknown[]) => mockAutosaveEncrypted(...args),
  storageApi: {
    getFileMetadata: vi.fn(),
    downloadFile: vi.fn(() => Promise.resolve(new Blob([SEEDED_PLAINTEXT_DECK]))),
  },
  encryptionApi: { getFileKey: vi.fn(() => Promise.resolve(null)) },
}));

vi.mock('@/app/(apps)/drive/ShareDialog', () => ({ ShareDialog: () => null }));

vi.mock('@/hooks/useSlidePresence', () => ({
  useSlidePresence: () => ({ remoteUsers: [], broadcastPresentation: vi.fn() }),
}));

const dek = new Uint8Array([1, 2, 3, 4]);
/**
 * `dekRef` is shared so a test can decide *when* the key shows up. The real
 * load order is not "key, then content": the content query is gated on
 * `dekResolved`, which means "resolution finished", and for a brand-new file
 * the key is still being minted and PUT when the body is first read.
 */
const dekRef: { current: Uint8Array | null } = { current: dek };
const encryptionState = { isNewEncryption: true };

vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => ({
    dekRef,
    dekResolved: true,
    isNewEncryption: encryptionState.isNewEncryption,
    // The content query awaits this rather than sampling `dekRef`, so that a
    // key still being minted is waited for instead of read as "no key".
    awaitDek: async () => dekRef.current,
  }),
}));

// The stored bytes are plaintext, so opening them with the DEK fails — which is
// exactly how the editor learns they were never sealed.
vi.mock('@neutrino/e2e-crypto', () => ({
  decryptFile: vi.fn(() => {
    throw new Error('not ciphertext');
  }),
  isUnlocked: () => true,
}));

vi.mock('@/hooks/useSpellCheck', () => ({ useSpellCheck: () => ({ spellCheck: false }) }));

vi.mock('@/providers/FeatureFlagsProvider', () => ({
  useFeatureFlags: () => ({ slidesVideoEmbeds: false, officeInPlaceEditing: true }),
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  encryptionState.isNewEncryption = true;
  dekRef.current = dek;
});

describe('SlideEditor — sealing a newly created deck', () => {
  it('re-saves the seeded plaintext body as ciphertext', async () => {
    renderSlideEditor();

    await waitFor(() => expect(mockAutosaveEncrypted).toHaveBeenCalled(), { timeout: 3000 });

    const [fileId, content, filename, key] = mockAutosaveEncrypted.mock.calls[0] as unknown[];
    expect(fileId).toBe('new-deck-id');
    expect(filename).toBe('slide.json');
    expect(key).toBe(dek);

    // What gets sealed is the deck on screen. When the stored bytes will not
    // open with the DEK the content query deliberately discards them (see the
    // `isNewEncryption` branch in SlideEditor's content query), so the body
    // here is the editor's own deck rather than the server's seed — the two are
    // the same title slide, and this is the copy the user is looking at.
    const written = JSON.parse(content as string);
    expect(written.slides).toHaveLength(1);
    expect(written.theme).toBeTruthy();
  });

  /**
   * The regression, in the order it actually happens.
   *
   * `dekResolved` means "resolution finished", not "a key exists", so the
   * content query fires while the DEK for a brand-new file is still being
   * minted. With no key in hand the body is read as plaintext and lands in
   * `lastSavedRef` — and the old guard, which also demanded
   * `lastSavedRef.current === ''`, then refused to seal it. The deck stayed
   * readable on the server for good.
   */
  it('seals the body even when it was read before the DEK arrived', async () => {
    dekRef.current = null;
    const { driveReadContent } = (await import('@/lib/api')) as unknown as {
      driveReadContent: { mockImplementation: (f: () => Promise<string>) => void };
    };
    // The key lands as the read comes back, exactly as the PUT does in a real load.
    driveReadContent.mockImplementation(async () => {
      dekRef.current = dek;
      return SEEDED_PLAINTEXT_DECK;
    });

    renderSlideEditor();

    await waitFor(() => expect(mockAutosaveEncrypted).toHaveBeenCalled(), { timeout: 3000 });

    const [, content] = mockAutosaveEncrypted.mock.calls[0] as unknown[];
    // Read as plaintext, so this is the server's own seed going back sealed.
    expect(JSON.parse(content as string).slides[0].id).toBe('s1');
  });

  it('writes exactly once, not on every render', async () => {
    const { rerender } = renderSlideEditor();

    await waitFor(() => expect(mockAutosaveEncrypted).toHaveBeenCalledTimes(1), { timeout: 3000 });

    rerender(
      React.createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        React.createElement(SlideEditor),
      ),
    );

    expect(mockAutosaveEncrypted).toHaveBeenCalledTimes(1);
  });

  it('never writes when the DEK came from the server', async () => {
    // `isNewEncryption: false` means the file already had a key ref, so content
    // that will not decrypt is corrupt ciphertext — overwriting it would
    // destroy the user's real work.
    encryptionState.isNewEncryption = false;

    renderSlideEditor();

    await new Promise((r) => setTimeout(r, 200));
    expect(mockAutosaveEncrypted).not.toHaveBeenCalled();
  });
});
