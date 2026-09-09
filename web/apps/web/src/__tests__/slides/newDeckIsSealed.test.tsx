/**
 * A newly created presentation must become a real, sealed package rather than
 * being left as the zero-byte record Drive creates.
 *
 * A `.pptx` is a zip, so the server writes no seed for one — `native_types.rs`
 * gives the OOXML types an empty `default_content` deliberately, because a seed
 * written there would be plaintext in object storage until the first save.
 * The editor is what closes that: opening a deck whose stored body is empty
 * writes the default deck through the ordinary encrypted autosave, now rather
 * than on the first edit, so a deck opened and closed again is not a zero-byte
 * file.
 *
 * This used to describe the opposite arrangement, in which Drive seeded a JSON
 * body from the bespoke mime type and the editor re-saved that plaintext as
 * ciphertext. No deck was ever stored in that format and it is gone.
 *
 * Mocking follows `officeMode.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** A deck body, as the editor would serialise one. */
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
  FontSizeInput: () => null,
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
    listThemes: vi.fn(() => Promise.resolve([])),
    saveSlide: vi.fn(() => Promise.resolve()),
  },
  // A record created a moment ago has no body at all.
  driveReadBytes: vi.fn(() => Promise.resolve(new Uint8Array())),
  driveAutosaveEncryptedBytes: (...args: unknown[]) => mockAutosaveEncrypted(...args),
  storageApi: {
    getFileMetadata: vi.fn(() =>
      Promise.resolve({
        id: 'new-deck-id',
        name: 'Untitled presentation.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        contentVersion: 1,
      }),
    ),
    downloadFile: vi.fn(() => Promise.resolve(new Blob())),
  },
  filesystemApi: { updateFile: vi.fn(() => Promise.resolve()) },
  extractSlideText: vi.fn(() => ''),
  encryptionApi: { getFileKey: vi.fn(() => Promise.resolve(null)) },
}));

vi.mock('@/app/(apps)/drive/ShareDialog', () => ({ ShareDialog: () => null }));

vi.mock('@/lib/ooxmlContainer', () => ({
  readNeutrinoModel: vi.fn(() => Promise.resolve(null)),
  // Hands the model through as the bytes, so what the save writes is readable
  // here without building a real package.
  packNeutrinoModel: vi.fn((_deck: unknown, _app: string, content: string) =>
    Promise.resolve(new TextEncoder().encode(content)),
  ),
}));

vi.mock('../../app/(apps)/slides/editor/pptxExport', () => ({
  exportAsPptx: vi.fn(),
  exportAsPptxBytes: vi.fn(() => Promise.resolve(new Uint8Array())),
}));

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

describe('SlideEditor — writing a newly created deck', () => {
  it('writes the empty record as a sealed package', async () => {
    renderSlideEditor();

    await waitFor(() => expect(mockAutosaveEncrypted).toHaveBeenCalled(), { timeout: 3000 });

    const [fileId, bytes, filename, key] = mockAutosaveEncrypted.mock.calls[0] as unknown[];
    expect(fileId).toBe('new-deck-id');
    // Under the file's own name — a package, not a body beside it.
    expect(filename).toBe('Untitled presentation.pptx');
    expect(key).toBe(dek);

    // What gets written is the default deck already on screen. `packNeutrinoModel`
    // is mocked to hand the model through as the bytes, so it reads back here.
    const written = JSON.parse(new TextDecoder().decode(bytes as Uint8Array));
    expect(written.slides).toHaveLength(1);
    expect(written.theme).toBeTruthy();
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

  it('never writes over a deck that already has a stored package', async () => {
    // The other half of the rule: the opening write exists to turn an *empty*
    // record into a real file. A deck with bytes already stored is content this
    // must not overwrite before the user has touched it.
    encryptionState.isNewEncryption = false;
    const { driveReadBytes } = (await import('@/lib/api')) as unknown as {
      driveReadBytes: { mockResolvedValue: (b: Uint8Array) => void };
    };
    driveReadBytes.mockResolvedValue(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]));

    renderSlideEditor();

    await new Promise((r) => setTimeout(r, 200));
    expect(mockAutosaveEncrypted).not.toHaveBeenCalled();
  });
});
