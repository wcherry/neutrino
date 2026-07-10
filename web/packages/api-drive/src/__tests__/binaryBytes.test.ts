/**
 * Unit tests for the binary-safe `*Bytes` sibling functions added to
 * api-drive/src/client.ts for issue #43 (in-place editing of MS Office docs).
 *
 * Office file bytes (raw .docx/.xlsx/.pptx) must never be run through the
 * existing string-based helpers (driveAutosaveContent / driveCreateVersion /
 * driveAutosaveEncryptedContent), which construct their multipart Blob with
 * `type: 'application/json'` and, for the encrypted variant, run the payload
 * through `TextEncoder` — both of which corrupt arbitrary binary content.
 * These new `*Bytes` functions must:
 *  - Accept raw bytes (Uint8Array | ArrayBuffer) directly, never a string.
 *  - Build the multipart Blob with the file's *real* mimeType, not
 *    'application/json'.
 *  - Preserve the exact byte content (no TextEncoder/TextDecoder round-trip,
 *    which would corrupt non-UTF8 binary data such as a zip-based OOXML file).
 *  - For the encrypted variants, pass the raw bytes straight into
 *    encryptFile() — not a TextEncoder-derived reinterpretation of them.
 *
 * These functions do not exist yet (red phase / TDD) — expected to fail with
 * a "no matching export" / "is not a function" error until they land in
 * web/packages/api-drive/src/client.ts.
 *
 * Mocking convention follows web/packages/api-admin/src/__tests__/client.test.ts:
 * mock @neutrino/api-core's `request` and assert on the exact call args.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @neutrino/api-core request
// ---------------------------------------------------------------------------

vi.mock('@neutrino/api-core', () => ({
  request: vi.fn(),
  ApiClientError: class ApiClientError extends Error {
    constructor(public statusCode: number, public code: string, message: string) {
      super(message);
    }
  },
  BASE_URL: '',
  buildQuery: () => '',
}));

import { request } from '@neutrino/api-core';
const mockRequest = vi.mocked(request);

// ---------------------------------------------------------------------------
// Mock @neutrino/e2e-crypto — the encrypted variants must call these directly
// on raw bytes, never through TextEncoder.
// ---------------------------------------------------------------------------

const mockEncryptFile = vi.fn((plaintext: Uint8Array) => {
  // Fake "ciphertext": just prefix the plaintext so we can assert the
  // exact input bytes flowed through untouched.
  const out = new Uint8Array(plaintext.length + 4);
  out.set([0xc1, 0xc2, 0xc3, 0xc4], 0);
  out.set(plaintext, 4);
  return out;
});

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: vi.fn(() => Promise.resolve()),
  encryptFile: mockEncryptFile,
}));

import {
  driveAutosaveBytes,
  driveCreateVersionBytes,
  driveAutosaveEncryptedBytes,
  driveCreateEncryptedVersionBytes,
} from '../client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A byte sequence that is NOT valid UTF-8 on its own (would be mangled by
 * any TextEncoder/TextDecoder round-trip), standing in for real OOXML zip bytes. */
function fakeOoxmlBytes(): Uint8Array {
  return new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x01, 0x80, 0x81]);
}

async function extractFormDataFile(body: unknown): Promise<{ blob: Blob; filename: string }> {
  expect(body).toBeInstanceOf(FormData);
  const fd = body as FormData;
  const entry = fd.get('file');
  expect(entry).toBeInstanceOf(Blob);
  // File extends Blob and additionally carries a `name`.
  const filename = (entry as File).name ?? '';
  return { blob: entry as Blob, filename };
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// driveAutosaveBytes
// ---------------------------------------------------------------------------

describe('driveAutosaveBytes', () => {
  it('PUTs to the autosave endpoint with a FormData body using the real mimetype', async () => {
    mockRequest.mockResolvedValueOnce(undefined);
    const bytes = fakeOoxmlBytes();

    await driveAutosaveBytes('file-1', bytes, 'report.docx', DOCX_MIME);

    expect(mockRequest).toHaveBeenCalledTimes(1);
    const [path, init] = mockRequest.mock.calls[0];
    expect(path).toBe('/api/v1/drive/files/file-1/autosave');
    expect((init as RequestInit).method).toBe('PUT');

    const { blob, filename } = await extractFormDataFile((init as RequestInit).body);
    expect(filename).toBe('report.docx');
    expect(blob.type).toBe(DOCX_MIME);
    expect(blob.type).not.toBe('application/json');
  });

  it('preserves the exact raw bytes with no TextEncoder/JSON transformation', async () => {
    mockRequest.mockResolvedValueOnce(undefined);
    const bytes = fakeOoxmlBytes();

    await driveAutosaveBytes('file-1', bytes, 'report.docx', DOCX_MIME);

    const [, init] = mockRequest.mock.calls[0];
    const { blob } = await extractFormDataFile((init as RequestInit).body);
    const roundTripped = await blobBytes(blob);
    expect(Array.from(roundTripped)).toEqual(Array.from(bytes));
  });

  it('accepts an ArrayBuffer as well as a Uint8Array', async () => {
    mockRequest.mockResolvedValueOnce(undefined);
    const bytes = fakeOoxmlBytes();

    await driveAutosaveBytes('file-1', bytes.buffer, 'report.docx', DOCX_MIME);

    const [, init] = mockRequest.mock.calls[0];
    const { blob } = await extractFormDataFile((init as RequestInit).body);
    const roundTripped = await blobBytes(blob);
    expect(Array.from(roundTripped)).toEqual(Array.from(bytes));
  });
});

// ---------------------------------------------------------------------------
// driveCreateVersionBytes
// ---------------------------------------------------------------------------

describe('driveCreateVersionBytes', () => {
  it('POSTs to the versions endpoint with a FormData body using the real mimetype', async () => {
    const versionItem = { id: 'v1', versionNumber: 2, label: null, createdAt: '', sizeBytes: 10 };
    mockRequest.mockResolvedValueOnce(versionItem);
    const bytes = fakeOoxmlBytes();

    const result = await driveCreateVersionBytes('file-1', bytes, 'report.docx', DOCX_MIME);

    expect(result).toEqual(versionItem);
    const [path, init] = mockRequest.mock.calls[0];
    expect(path).toBe('/api/v1/drive/files/file-1/versions');
    expect((init as RequestInit).method).toBe('POST');
    const { blob, filename } = await extractFormDataFile((init as RequestInit).body);
    expect(filename).toBe('report.docx');
    expect(blob.type).toBe(DOCX_MIME);
  });

  it('appends an optional label to the FormData', async () => {
    mockRequest.mockResolvedValueOnce({ id: 'v1' });
    const bytes = fakeOoxmlBytes();

    await driveCreateVersionBytes('file-1', bytes, 'report.docx', DOCX_MIME, 'Before edits');

    const [, init] = mockRequest.mock.calls[0];
    const fd = (init as RequestInit).body as FormData;
    expect(fd.get('label')).toBe('Before edits');
  });

  it('preserves the exact raw bytes', async () => {
    mockRequest.mockResolvedValueOnce({ id: 'v1' });
    const bytes = fakeOoxmlBytes();

    await driveCreateVersionBytes('file-1', bytes, 'report.docx', DOCX_MIME);

    const [, init] = mockRequest.mock.calls[0];
    const { blob } = await extractFormDataFile((init as RequestInit).body);
    const roundTripped = await blobBytes(blob);
    expect(Array.from(roundTripped)).toEqual(Array.from(bytes));
  });
});

// ---------------------------------------------------------------------------
// driveAutosaveEncryptedBytes
// ---------------------------------------------------------------------------

describe('driveAutosaveEncryptedBytes', () => {
  it('encrypts the raw bytes directly (not via TextEncoder) and PUTs octet-stream', async () => {
    mockRequest.mockResolvedValueOnce(undefined);
    const bytes = fakeOoxmlBytes();
    const dek = new Uint8Array(32).fill(7);

    await driveAutosaveEncryptedBytes('file-1', bytes, 'report.docx', dek);

    expect(mockEncryptFile).toHaveBeenCalledTimes(1);
    const [plaintextArg, dekArg] = mockEncryptFile.mock.calls[0];
    // The exact original bytes must be handed to encryptFile — no TextEncoder
    // re-encoding, which would corrupt bytes like 0xff/0xfe that aren't valid UTF-8.
    expect(Array.from(plaintextArg as Uint8Array)).toEqual(Array.from(bytes));
    expect(dekArg).toBe(dek);

    const [path, init] = mockRequest.mock.calls[0];
    expect(path).toBe('/api/v1/drive/files/file-1/autosave');
    expect((init as RequestInit).method).toBe('PUT');
    const { blob } = await extractFormDataFile((init as RequestInit).body);
    expect(blob.type).toBe('application/octet-stream');
  });

  it('uploads the encrypted (not plaintext) bytes returned by encryptFile', async () => {
    mockRequest.mockResolvedValueOnce(undefined);
    const bytes = fakeOoxmlBytes();
    const dek = new Uint8Array(32).fill(7);

    await driveAutosaveEncryptedBytes('file-1', bytes, 'report.docx', dek);

    const [, init] = mockRequest.mock.calls[0];
    const { blob } = await extractFormDataFile((init as RequestInit).body);
    const uploaded = await blobBytes(blob);
    // mockEncryptFile prefixes 4 marker bytes — confirms the *encrypted*
    // output (not the raw plaintext) is what gets uploaded.
    expect(Array.from(uploaded.slice(0, 4))).toEqual([0xc1, 0xc2, 0xc3, 0xc4]);
  });
});

// ---------------------------------------------------------------------------
// driveCreateEncryptedVersionBytes
// ---------------------------------------------------------------------------

describe('driveCreateEncryptedVersionBytes', () => {
  it('encrypts the raw bytes directly and POSTs to the versions endpoint', async () => {
    mockRequest.mockResolvedValueOnce({ id: 'v2' });
    const bytes = fakeOoxmlBytes();
    const dek = new Uint8Array(32).fill(9);

    const result = await driveCreateEncryptedVersionBytes('file-1', bytes, 'report.docx', dek, 'Snapshot');

    expect(result).toEqual({ id: 'v2' });
    expect(mockEncryptFile).toHaveBeenCalledTimes(1);
    const [plaintextArg] = mockEncryptFile.mock.calls[0];
    expect(Array.from(plaintextArg as Uint8Array)).toEqual(Array.from(bytes));

    const [path, init] = mockRequest.mock.calls[0];
    expect(path).toBe('/api/v1/drive/files/file-1/versions');
    expect((init as RequestInit).method).toBe('POST');
    const fd = (init as RequestInit).body as FormData;
    expect(fd.get('label')).toBe('Snapshot');
  });
});
