/**
 * New from template (issue #128).
 *
 * The copy is made in the browser because only the browser can open the
 * template: what these pin down is that the new document is sealed under a
 * key of its own, named and declared as a document, and that nothing is
 * created when the copy cannot be made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
  docsApi: { createDoc: vi.fn() },
  driveReadBytes: vi.fn(),
  driveCreateEncryptedVersionBytes: vi.fn(),
  mintFileKey: vi.fn(),
  canEncryptFor: vi.fn(),
}));
vi.mock('@/lib/api', () => api);

const resolveDek = vi.hoisted(() => vi.fn());
vi.mock('@/lib/documentContent', () => ({ resolveDek }));

const crypto = vi.hoisted(() => ({
  initSodium: vi.fn(async () => {}),
  decryptFile: vi.fn(),
}));
vi.mock('@neutrino/e2e-crypto', () => crypto);

import JSZip from 'jszip';
import { createDocFromTemplate, TemplateEncryptionUnavailableError } from '@/lib/docTemplates';
import { readDocxPackageKind } from '@/lib/ooxml/docx/packageKind';

const TEMPLATE_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml';

/** A minimal package that declares itself a template. */
async function templatePackage(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Override PartName="/word/document.xml" ContentType="${TEMPLATE_MAIN}"/></Types>`);
  zip.file('word/document.xml', '<w:document/>');
  return zip.generateAsync({ type: 'uint8array' });
}

const CIPHERTEXT = new Uint8Array([9, 9, 9, 9]);
const TEMPLATE_DEK = new Uint8Array([1]);
const NEW_DEK = new Uint8Array([2]);

beforeEach(() => {
  vi.clearAllMocks();
  api.canEncryptFor.mockResolvedValue(true);
  api.docsApi.createDoc.mockResolvedValue({ id: 'new-doc' });
  api.mintFileKey.mockResolvedValue(NEW_DEK);
  api.driveCreateEncryptedVersionBytes.mockResolvedValue({});
  api.driveReadBytes.mockResolvedValue(CIPHERTEXT);
  resolveDek.mockResolvedValue(TEMPLATE_DEK);
});

describe('createDocFromTemplate', () => {
  it('opens the template with its key and seals the copy under a new one', async () => {
    const plain = await templatePackage();
    crypto.decryptFile.mockReturnValue(plain);

    const id = await createDocFromTemplate({
      userId: 'u1', templateId: 'tpl', title: 'March invoice', folderId: 'f1',
    });

    expect(id).toBe('new-doc');
    expect(crypto.decryptFile).toHaveBeenCalledWith(CIPHERTEXT, TEMPLATE_DEK);
    expect(api.docsApi.createDoc).toHaveBeenCalledWith({ title: 'March invoice', folderId: 'f1' });
    expect(api.mintFileKey).toHaveBeenCalledWith('u1', 'new-doc');

    const [fileId, bytes, filename, dek] = api.driveCreateEncryptedVersionBytes.mock.calls[0];
    expect(fileId).toBe('new-doc');
    expect(filename).toBe('March invoice.docx');
    expect(dek).toBe(NEW_DEK);
    // Written under a `.docx` name, so the package must say "document" — a
    // template content type there is a file Word refuses to open.
    expect(await readDocxPackageKind(bytes)).toBe('document');
  });

  it('uses a plaintext template as stored', async () => {
    resolveDek.mockResolvedValue(null);
    api.driveReadBytes.mockResolvedValue(await templatePackage());

    await createDocFromTemplate({ userId: 'u1', templateId: 'tpl', title: 'Memo' });

    expect(crypto.decryptFile).not.toHaveBeenCalled();
    const bytes = api.driveCreateEncryptedVersionBytes.mock.calls[0][1];
    expect(await readDocxPackageKind(bytes)).toBe('document');
  });

  it('creates nothing when this session cannot encrypt', async () => {
    api.canEncryptFor.mockResolvedValue(false);

    await expect(
      createDocFromTemplate({ userId: 'u1', templateId: 'tpl', title: 'Memo' }),
    ).rejects.toBeInstanceOf(TemplateEncryptionUnavailableError);
    expect(api.driveReadBytes).not.toHaveBeenCalled();
    expect(api.docsApi.createDoc).not.toHaveBeenCalled();
  });

  it('creates nothing when the template cannot be opened', async () => {
    // Copying ciphertext the key does not open would hand the new document a
    // body nobody can read.
    crypto.decryptFile.mockImplementation(() => { throw new Error('bad key'); });

    await expect(
      createDocFromTemplate({ userId: 'u1', templateId: 'tpl', title: 'Memo' }),
    ).rejects.toThrow('template-unreadable');
    expect(api.docsApi.createDoc).not.toHaveBeenCalled();
  });

  it('turns an empty template into a blank document the editor will seal', async () => {
    api.driveReadBytes.mockResolvedValue(new Uint8Array(0));

    const id = await createDocFromTemplate({ userId: 'u1', templateId: 'tpl', title: 'Blank' });

    expect(id).toBe('new-doc');
    expect(api.docsApi.createDoc).toHaveBeenCalled();
    expect(api.driveCreateEncryptedVersionBytes).not.toHaveBeenCalled();
  });
});
