/**
 * Fixture data, seeded through the API and sealed from Node.
 *
 * §4 of the design doc: everything is seeded through the API, never the UI, so
 * setup cost never lands inside a measurement and the fixture is identical on
 * every run. That is only possible because the content is E2EE in a way Node
 * can reproduce — `session.ts` reads the account's keypair out of the browser's
 * keyring, and from there sealing a DEK is the same three calls the app makes:
 *
 *     dek = generateFileKey()
 *     POST /drive/files/upload   (encryptFile(bytes, dek), encryptMetadata)
 *     PUT  /drive/files/{id}/key (encryptFileKey(dek, publicKey))
 *
 * The sizes come from `env.ts`, keyed `S` / `M` / `L`, so a scenario names a
 * size and never a number.
 */

import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  encryptFile,
  encryptFileKey,
  encryptMetadata,
  generateFileKey,
  initSodium,
} from '../../../web/packages/e2e-crypto/src/crypto';
import { BASE_URL, SCALE, type Scale } from './env';
import { authHeaders, type Session } from './session';
import {
  buildDiagram,
  buildDocx,
  buildDrawing,
  buildPptx,
  buildXlsx,
  readPhoto,
  thumbnailB64,
} from './documents';

const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/x-neutrino-doc',
  diagram: 'application/x-neutrino-diagram',
  drawing: 'application/x-neutrino-drawing',
  note: 'application/x-neutrino-note',
  text: 'text/plain',
  jpeg: 'image/jpeg',
} as const;

/**
 * How many uploads are in flight at once.
 *
 * Not higher, and the number is not arbitrary. The test stack is one SQLite
 * database, and `e2ee.ts` already documents what write contention does to it —
 * `database is locked` surfacing as a 500 from an unrelated endpoint. Four
 * keeps a thousand-file seed to a couple of minutes without provoking it.
 */
const CONCURRENCY = 4;

/** Retry a seeding write past the transient lock contention above. */
const ATTEMPTS = 3;

export interface SeededFile {
  id: string;
  name: string;
  /** Kept so a scenario can decrypt what it seeded, and for autosave writes. */
  dek: Uint8Array;
}

async function uploadSealed(
  session: Session,
  args: {
    name: string;
    mimeType: string;
    bytes: Buffer;
    folderId?: string;
    thumbnail?: string | null;
    /**
     * Seal the body, and register a DEK for it. True for everything a user
     * would have uploaded; false for the native JSON types, which the *server*
     * seeds in plaintext (`default_content` in `native_types.rs`) and which the
     * client encrypts on its first save.
     */
    encrypt?: boolean;
  },
): Promise<SeededFile> {
  await initSodium();
  const encrypt = args.encrypt !== false;
  const dek = generateFileKey();
  const body = encrypt
    ? Buffer.from(encryptFile(new Uint8Array(args.bytes), dek))
    : args.bytes;

  // Field order is load-bearing. The upload handler streams the multipart and
  // acts on the file part as it arrives, so a field that appears *after* the
  // file has already been missed — which is how the first version of this
  // seeded a thousand files into a folder and left the folder empty.
  const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {};
  if (args.folderId) multipart.folder_id = args.folderId;
  multipart.mime_type = args.mimeType;
  if (encrypt) {
    multipart.encrypted_metadata = encryptMetadata(
      { name: args.name, mimeType: args.mimeType },
      dek,
    );
  }
  if (args.thumbnail) multipart.thumbnail_b64 = args.thumbnail;
  multipart.file = {
    name: args.name,
    mimeType: encrypt ? 'application/octet-stream' : args.mimeType,
    buffer: body,
  };

  let lastError = '';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const res = await session.request.post(`${BASE_URL}/api/v1/drive/files/upload`, {
      headers: authHeaders(session.token),
      multipart,
    });
    if (res.ok()) {
      const { id } = (await res.json()) as { id: string };
      if (!encrypt) return { id, name: args.name, dek };
      const keyRes = await session.request.put(
        `${BASE_URL}/api/v1/drive/files/${id}/key`,
        {
          headers: { ...authHeaders(session.token), 'Content-Type': 'application/json' },
          data: { encryptedFileKey: encryptFileKey(dek, fromB64url(session.keyPair.publicKey)) },
        },
      );
      expect(keyRes.ok(), `sealing the DEK failed: ${keyRes.status()}`).toBeTruthy();
      return { id, name: args.name, dek };
    }
    lastError = `${res.status()} ${await res.text()}`;
  }
  throw new Error(`seeding "${args.name}" failed after ${ATTEMPTS} attempts: ${lastError}`);
}

function fromB64url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

/** Run `task` over `items`, `CONCURRENCY` at a time, preserving order. */
async function pool<T, R>(
  items: T[],
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      out[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}


/**
 * Create a native JSON document the way the app does, then write its body.
 *
 * Two calls, not one, and the difference matters. `POST /drive/files` is what
 * creates a diagram, drawing or note — the server writes `default_content`
 * from the type registry, so the record exists in the state every one of these
 * editors is written to open. Uploading a body instead produces a file with
 * the right mime type that the editors do not necessarily reach the same way,
 * which is how the first version of `E4` left the diagram toolbar never
 * rendering.
 *
 * The body then goes through the same autosave endpoint the editor's own first
 * save uses, in plaintext — see `seedDocWithImages` for why these types are
 * not sealed here.
 */
async function createNative(
  session: Session,
  args: { name: string; mimeType: string; bytes: Buffer },
): Promise<SeededFile> {
  const created = await session.request.post(`${BASE_URL}/api/v1/drive/files`, {
    headers: { ...authHeaders(session.token), 'Content-Type': 'application/json' },
    data: {
      id: randomUUID(),
      name: args.name,
      mimeType: args.mimeType,
      folderId: null,
    },
  });
  expect(
    created.ok(),
    `creating "${args.name}" failed: ${created.status()} ${await created.text()}`,
  ).toBeTruthy();
  const { id } = (await created.json()) as { id: string };

  const written = await session.request.put(
    `${BASE_URL}/api/v1/drive/files/${id}/autosave`,
    {
      headers: authHeaders(session.token),
      multipart: {
        file: { name: args.name, mimeType: args.mimeType, buffer: args.bytes },
      },
    },
  );
  expect(
    written.ok(),
    `writing "${args.name}" failed: ${written.status()} ${await written.text()}`,
  ).toBeTruthy();

  return { id, name: args.name, dek: new Uint8Array() };
}

// ── Generators ──────────────────────────────────────────────────────────────

/**
 * `n` small text files in My Drive.
 *
 * Deliberately tiny and all the same size: `B1`/`B2` measure what rendering
 * *rows* costs, and varying the bytes would only add noise to a number that is
 * about DOM nodes and React work.
 */
export async function seedFiles(
  session: Session,
  scale: Scale,
  opts: { folderId?: string; prefix?: string } = {},
): Promise<SeededFile[]> {
  const count = SCALE.files[scale];
  const prefix = opts.prefix ?? 'perf-file';
  const names = Array.from({ length: count }, (_, i) =>
    `${prefix}-${String(i).padStart(5, '0')}.txt`,
  );
  return pool(names, (name, i) =>
    uploadSealed(session, {
      name,
      mimeType: MIME.text,
      bytes: Buffer.from(`perf fixture row ${i}\n`),
      folderId: opts.folderId,
    }),
  );
}

export async function seedDoc(session: Session, scale: Scale): Promise<SeededFile> {
  const bytes = await buildDocx(SCALE.paragraphs[scale]);
  return uploadSealed(session, {
    name: `perf-doc-${scale}.docx`,
    mimeType: MIME.docx,
    bytes,
  });
}

/**
 * A document whose images are Drive references — the `C4` fixture.
 *
 * Written in the legacy `application/x-neutrino-doc` ProseMirror JSON rather
 * than as a `.docx`, and that is the point rather than a shortcut. A `.docx`
 * carries image *bytes*: `writeDocx` resolves every `neutrino-drive:` reference
 * to bytes before packaging, and `readDocx` hands them back as data URLs. So a
 * `.docx` fixture would measure zip extraction, and never touch the path C4
 * exists to measure — `driveImages.ts` downloading each image and decrypting
 * it on the main thread, which is §8 finding 5.
 *
 * The legacy type is still read and written unchanged (`native_types.rs`), so
 * this is a document the app genuinely opens, not a synthetic one.
 *
 * The body is seeded in **plaintext**, which is not a shortcut either: that is
 * the state the server creates a native JSON document in (`default_content`),
 * and the client's first save is what seals it. A body sealed here instead is
 * read back as ciphertext and rendered as a paragraph of binary — the legacy
 * read path has no decrypt step, because in production there is nothing at
 * that point to decrypt. The images it *references* are ordinary encrypted
 * Drive files, which is the part this scenario exists to measure.
 */
export async function seedDocWithImages(
  session: Session,
  imageIds: string[],
): Promise<SeededFile> {
  const content: unknown[] = [];
  imageIds.forEach((id, i) => {
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: `Figure ${i + 1}` }],
    });
    content.push({
      type: 'image',
      // Mirrors `driveImageRef` in `web/apps/web/src/lib/driveImages.ts`.
      attrs: { src: `neutrino-drive:${id}`, alt: `Figure ${i + 1}` },
    });
  });

  return createNative(session, {
    name: `perf-doc-images-${imageIds.length}`,
    mimeType: MIME.doc,
    bytes: Buffer.from(JSON.stringify({ type: 'doc', content })),
  });
}

export async function seedSheet(
  session: Session,
  scale: Scale,
  opts: { formulaRows?: number } = {},
): Promise<SeededFile> {
  const bytes = await buildXlsx({
    cells: SCALE.cells[scale],
    formulaRows: opts.formulaRows,
  });
  return uploadSealed(session, {
    name: `perf-sheet-${scale}.xlsx`,
    mimeType: MIME.xlsx,
    bytes,
  });
}

export async function seedDeck(
  session: Session,
  scale: Scale,
  opts: { elementsPerSlide?: number } = {},
): Promise<SeededFile> {
  const bytes = await buildPptx(
    SCALE.slides[scale],
    opts.elementsPerSlide ?? 4,
  );
  return uploadSealed(session, {
    name: `perf-deck-${scale}.pptx`,
    mimeType: MIME.pptx,
    bytes,
  });
}

export async function seedDiagram(session: Session, scale: Scale): Promise<SeededFile> {
  return createNative(session, {
    name: `perf-diagram-${scale}`,
    mimeType: MIME.diagram,
    bytes: Buffer.from(buildDiagram(SCALE.diagramNodes[scale])),
  });
}

export async function seedDrawing(session: Session, shapes: number): Promise<SeededFile> {
  return createNative(session, {
    name: `perf-drawing-${shapes}`,
    mimeType: MIME.drawing,
    bytes: Buffer.from(buildDrawing(shapes)),
  });
}

/**
 * `n` photos, registered with the Photos app rather than only uploaded.
 *
 * The registration is the difference between a photo and an image sitting in
 * Drive: `/photos` lists what `POST /api/v1/photos` knows about. Each one gets
 * the same thumbnail, which is what the grid paints — and, per issue #175,
 * what it inlines into the listing response.
 */
export async function seedPhotos(
  session: Session,
  scale: Scale,
  opts: { size?: 'standard' | 'large' } = {},
): Promise<SeededFile[]> {
  const count = SCALE.photos[scale];
  const bytes = readPhoto(opts.size ?? 'standard');
  const thumb = thumbnailB64();

  const indices = Array.from({ length: count }, (_, i) => i);
  return pool(indices, async (i) => {
    const file = await uploadSealed(session, {
      name: `perf-photo-${String(i).padStart(5, '0')}.jpg`,
      mimeType: MIME.jpeg,
      bytes,
      thumbnail: thumb,
    });
    const res = await session.request.post(`${BASE_URL}/api/v1/photos`, {
      headers: { ...authHeaders(session.token), 'Content-Type': 'application/json' },
      data: { fileId: file.id, metadata: null },
    });
    expect(res.ok(), `registering photo failed: ${res.status()}`).toBeTruthy();
    return file;
  });
}

/** A folder, for the scenarios that need Drive to have somewhere to navigate. */
export async function seedFolder(session: Session, name: string): Promise<string> {
  const res = await session.request.post(`${BASE_URL}/api/v1/drive/folders`, {
    headers: { ...authHeaders(session.token), 'Content-Type': 'application/json' },
    data: { name, parentId: null },
  });
  expect(res.ok(), `creating folder failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const { id } = (await res.json()) as { id: string };
  return id;
}

/** Notes, which are Drive files with the note mime type and nothing else. */
export async function seedNotes(session: Session, count: number): Promise<SeededFile[]> {
  const indices = Array.from({ length: count }, (_, i) => i);
  return pool(indices, (i) =>
    createNative(session, {
      name: `perf-note-${String(i).padStart(4, '0')}`,
      mimeType: MIME.note,
      bytes: Buffer.from(JSON.stringify({ type: 'doc', content: [] })),
    }),
  );
}

export { MIME };
