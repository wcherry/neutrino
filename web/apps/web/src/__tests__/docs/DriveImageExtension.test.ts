/**
 * Unit tests for DriveImageExtension — the bridge between an image node whose
 * src is a Drive reference and the `<img>` the browser can actually paint.
 *
 * The property that matters most here is the last one: resolving must never
 * write to the document. If the resolved URL ended up in the node's attrs, the
 * next autosave would put a blob URL (dead on reload) or the image bytes back
 * into the file — which is the thing references exist to avoid.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';

const getFileMetadata = vi.fn();

vi.mock('@/lib/api', () => ({
  storageApi: {
    getFileMetadata: (...a: unknown[]) => getFileMetadata(...a),
    downloadFile: vi.fn(),
    getFileDownloadUrl: (id: string) => `https://drive.test/files/${id}?token=t`,
    uploadFile: vi.fn(),
  },
  filesystemApi: { getFolderContents: vi.fn(), createFolder: vi.fn() },
  encryptionApi: { getFileKey: vi.fn() },
}));

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: () => Promise.resolve(),
  loadKeyPair: () => ({ publicKey: 'pk', secretKey: 'sk' }),
  decryptFileKey: () => 'dek',
  decryptFile: () => new Uint8Array([1]),
}));

import { DriveImageExtension } from '@/lib/extensions/DriveImageExtension';
import { clearDriveImageCache, driveImageRef } from '@/lib/driveImages';

function makeEditor(src: string) {
  return new Editor({
    extensions: [StarterKit, Image.configure({ allowBase64: true }), DriveImageExtension],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src } }] }] },
  });
}

function renderedImg(editor: Editor): HTMLImageElement {
  return editor.view.dom.querySelector('img')!;
}

/** The src the document would be saved with. */
function storedSrc(editor: Editor): string {
  const doc = editor.getJSON() as { content?: { content?: { attrs?: { src?: string } }[] }[] };
  return doc.content?.[0]?.content?.[0]?.attrs?.src ?? '';
}

let editor: Editor | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  clearDriveImageCache();
  localStorage.setItem(
    'access_token',
    `header.${btoa(JSON.stringify({ sub: 'user-1' }))}.sig`,
  );
  getFileMetadata.mockImplementation(async (id: string) => ({
    id, name: 'photo.png', mimeType: 'image/png', encryptedMetadata: null,
  }));
});

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('DriveImageExtension', () => {
  it('paints the resolved image over a referenced node', async () => {
    editor = makeEditor(driveImageRef('file-1'));

    // Before resolution the node shows a blank, not the unloadable reference:
    // an <img> pointed at one paints a broken-image icon.
    expect(renderedImg(editor).getAttribute('src')).toMatch(/^data:image\/gif/);

    await vi.waitFor(() =>
      expect(renderedImg(editor!).getAttribute('src')).toBe('https://drive.test/files/file-1?token=t'),
    );
  });

  it('leaves the document holding the reference, never the resolved src', async () => {
    editor = makeEditor(driveImageRef('file-2'));
    await vi.waitFor(() =>
      expect(renderedImg(editor!).getAttribute('src')).toBe('https://drive.test/files/file-2?token=t'),
    );

    expect(storedSrc(editor)).toBe('neutrino-drive:file-2');
    expect(editor.getHTML()).toContain('neutrino-drive:file-2');
  });

  it('does not mark the document dirty when an image resolves', async () => {
    editor = makeEditor(driveImageRef('file-3'));
    const onUpdate = vi.fn();
    editor.on('update', onUpdate);

    await vi.waitFor(() =>
      expect(renderedImg(editor!).getAttribute('src')).toBe('https://drive.test/files/file-3?token=t'),
    );

    // `update` is what autosave listens to — resolving must not trigger a save.
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('leaves a plain src alone', async () => {
    editor = makeEditor('https://example.test/a.png');

    expect(renderedImg(editor).getAttribute('src')).toBe('https://example.test/a.png');
    expect(getFileMetadata).not.toHaveBeenCalled();
  });

  it('leaves a legacy data URL alone', async () => {
    const dataUrl = 'data:image/png;base64,AAA';
    editor = makeEditor(dataUrl);

    expect(renderedImg(editor).getAttribute('src')).toBe(dataUrl);
    expect(getFileMetadata).not.toHaveBeenCalled();
  });

  it('resolves an image only once even as the document is edited', async () => {
    editor = makeEditor(driveImageRef('file-4'));
    await vi.waitFor(() => expect(getFileMetadata).toHaveBeenCalledTimes(1));

    editor.commands.insertContentAt(0, 'typing');
    editor.commands.insertContentAt(0, ' more');

    expect(getFileMetadata).toHaveBeenCalledTimes(1);
  });

  it('keeps the blank in place when an image cannot be resolved', async () => {
    getFileMetadata.mockRejectedValue(new Error('gone'));
    editor = makeEditor(driveImageRef('missing'));

    await vi.waitFor(() => expect(getFileMetadata).toHaveBeenCalled());
    expect(renderedImg(editor).getAttribute('src')).toMatch(/^data:image\/gif/);
    // Still recoverable: the document kept the reference.
    expect(storedSrc(editor)).toBe('neutrino-drive:missing');
  });
});
