/**
 * Drawings are E2EE like everything else (issue #95).
 *
 * They were the one exception. `drawingApi.autosaveContent` wrote the body to
 * Drive as `application/json` — readable text, no key ref, no route back — so
 * every drawing ever saved sat in storage in the clear while the note, doc,
 * sheet, slide and diagram beside it were ciphertext. Nobody had decided that;
 * the app simply never grew an encrypted write, and the plaintext one worked.
 *
 * What is covered here is the whole round trip, because a half-migration is
 * worse than none: encrypting the save without decrypting the load turns every
 * existing drawing into an empty canvas, and the "existing drawing" case is
 * what `isNewEncryption` exists to keep working.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import React from 'react';

const DRAWING_ID = 'draw-1';
const DEK = new Uint8Array(32).fill(5);

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'id' ? DRAWING_ID : null) }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

const autosaveEncryptedContent = vi.fn();
const getDrawing = vi.fn();

vi.mock('@neutrino/api-drawing', () => ({
  drawingApi: {
    getDrawing: (...a: unknown[]) => getDrawing(...a),
    autosaveEncryptedContent: (...a: unknown[]) => autosaveEncryptedContent(...a),
  },
  extractDrawingText: () => '',
}));

/** The plaintext read path, for a drawing saved before this change. */
const readContentAsText = vi.fn();
vi.mock('@neutrino/api-core', () => ({
  request: (...a: unknown[]) => readContentAsText(...a),
}));

const downloadFile = vi.fn();
vi.mock('@neutrino/api-drive', () => ({
  storageApi: { downloadFile: (...a: unknown[]) => downloadFile(...a) },
  isMissingEncryptionKey: (err: unknown) => err instanceof Error && err.message === 'no-dek',
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  // Ciphertext here is the plaintext with a marker prefix, so a test can tell
  // "decrypted correctly" from "read the raw bytes and got lucky".
  decryptFile: (bytes: Uint8Array) => bytes.slice(4),
}));

let dekNow: Uint8Array | null = DEK;
let isNewEncryption = false;
vi.mock('@/hooks/useEncryptedDocumentContent', () => ({
  useEncryptedDocumentContent: () => ({
    dekRef: { get current() { return dekNow; } },
    dekResolved: true,
    isNewEncryption,
    awaitDek: () => Promise.resolve(dekNow),
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

vi.mock('@neutrino/auth', () => ({ useUser: () => ({ id: 'user-1' }) }));
vi.mock('@/lib/searchIndexUpdate', () => ({ indexOnSave: vi.fn() }));
vi.mock('@/hooks/useContentVersionGuard', () => ({
  useContentVersionGuard: () => ({
    observe: vi.fn(), check: () => undefined, handleError: () => false,
  }),
}));

vi.mock('next/dynamic', () => ({ default: () => () => null }));

/** Captures the canvas' onShapesChange so a test can make the editor dirty. */
let onShapesChange: (shapes: unknown[]) => void = () => {};
vi.mock('../../app/(apps)/drawing/editor/DrawingCanvas', () => ({
  DrawingCanvas: (props: { onShapesChange?: (s: unknown[]) => void }) => {
    if (props.onShapesChange) onShapesChange = props.onShapesChange;
    return <div data-testid="canvas" />;
  },
}));
vi.mock('../../app/(apps)/drawing/editor/DrawingToolbar', () => ({ DrawingToolbar: () => null }));
vi.mock('../../app/(apps)/drawing/editor/DrawingMenuBar', () => ({ DrawingMenuBar: () => null }));
vi.mock('../../app/(apps)/drawing/editor/StatusBar', () => ({ StatusBar: () => null }));
vi.mock('../../app/(apps)/drawing/editor/StylePanel', () => ({ StylePanel: () => null }));
vi.mock('../../app/(apps)/drawing/editor/LayersPanel', () => ({ LayersPanel: () => null }));
vi.mock('../../app/(apps)/drawing/editor/ExportDialog', () => ({ ExportDialog: () => null }));
vi.mock('../../app/(apps)/drawing/editor/page.module.css', () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BODY = JSON.stringify({
  version: 1,
  shapes: [{ id: 's1', type: 'rect', layerId: 'bg', text: 'hello' }],
  layers: [{ id: 'bg', name: 'Background', isBackground: true }],
});

/** The stored form of `BODY` once encrypted: a 4-byte marker, then the text. */
function asCiphertext(text: string): Uint8Array {
  const plain = new TextEncoder().encode(text);
  const out = new Uint8Array(plain.length + 4);
  out.set([0xc1, 0xc2, 0xc3, 0xc4], 0);
  out.set(plain, 4);
  return out;
}

async function renderEditor() {
  const { DrawingEditor } = await import('../../app/(apps)/drawing/editor/DrawingEditor');
  return render(<DrawingEditor />);
}

/**
 * Render and wait until the canvas is on screen.
 *
 * The editor shows a spinner while loading, so the canvas — and with it the
 * `onShapesChange` handle these tests drive — does not exist until the load
 * settles. Waiting on `getDrawing` alone is not enough: it resolves the moment
 * the request goes out, leaving `onShapesChange` pointing at the previous
 * test's unmounted editor, where setting state is a silent no-op.
 */
async function renderLoadedEditor() {
  const utils = await renderEditor();
  await utils.findByTestId('canvas');
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  dekNow = DEK;
  isNewEncryption = false;
  getDrawing.mockResolvedValue({
    id: DRAWING_ID,
    title: 'Sketch',
    contentUrl: `/api/v1/drive/files/${DRAWING_ID}`,
    contentVersion: 1,
  });
  downloadFile.mockResolvedValue(new Blob([asCiphertext(BODY).buffer as ArrayBuffer]));
  readContentAsText.mockResolvedValue(BODY);
  autosaveEncryptedContent.mockResolvedValue({ contentVersion: 2 });
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

describe('loading a drawing', () => {
  it('downloads and decrypts a drawing that has a key', async () => {
    await renderEditor();

    await waitFor(() => expect(downloadFile).toHaveBeenCalledWith(DRAWING_ID));
    // `responseType: 'text'` on ciphertext is a UTF-8 decode of random bytes —
    // mojibake, and a silently empty canvas. The blob path is the only correct
    // one for an encrypted body.
    expect(readContentAsText).not.toHaveBeenCalled();
  });

  /**
   * A drawing saved before this change is still plaintext, and
   * `useEncryptedDocumentContent` hands out a freshly minted DEK for it — so
   * "has a DEK" cannot be the test for "is encrypted". `isNewEncryption` is,
   * and getting it wrong empties the user's canvas on open.
   */
  it('reads a pre-existing plaintext drawing as text', async () => {
    isNewEncryption = true;

    await renderEditor();

    await waitFor(() => expect(readContentAsText).toHaveBeenCalled());
    expect(downloadFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

describe('saving a drawing', () => {
  it('writes the body encrypted', async () => {
    await renderLoadedEditor();

    await act(async () => {
      onShapesChange([{ id: 's2', type: 'ellipse', layerId: 'bg' }]);
      // Past the 1 s shape debounce.
      await new Promise((r) => setTimeout(r, 1200));
    });

    await waitFor(() => expect(autosaveEncryptedContent).toHaveBeenCalled());
    const [id, content, filename, dek] = autosaveEncryptedContent.mock.calls[0];
    expect(id).toBe(DRAWING_ID);
    expect(filename).toBe('drawing.json');
    expect(dek).toBe(DEK);
    expect(JSON.parse(content as string)).toMatchObject({ version: 1 });
  });

  it('writes nothing when the vault is locked', async () => {
    await renderLoadedEditor();
    dekNow = null;

    await act(async () => {
      onShapesChange([{ id: 's2', type: 'ellipse', layerId: 'bg' }]);
      await new Promise((r) => setTimeout(r, 1200));
    });

    expect(autosaveEncryptedContent).not.toHaveBeenCalled();
    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
  });
});
