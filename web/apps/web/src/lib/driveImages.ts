/**
 * Images in documents are stored as a *reference* to a Drive file, never as the
 * image itself. A document carries `neutrino-drive:<fileId>` where an `<img>`
 * src would normally go, and the bytes are resolved at render time by this
 * module.
 *
 * Two reasons it works this way. Embedding the bytes put megabytes of base64
 * into every document that used a photo, duplicated per document and paid for
 * on every load and save. And a Drive file's download URL is not usable as an
 * `src` in the general case: an E2EE file downloads as ciphertext, which the
 * browser accepts with a 200 and then silently fails to decode. Resolving here
 * means one place knows how to turn an id into something displayable, and one
 * place holds the cache.
 *
 * Anything that is not a reference — an `http(s):` URL, a `data:` URL — passes
 * through untouched, so documents written before this keep rendering.
 */

import { storageApi, filesystemApi, encryptionApi, uploadEncryptedFile } from '@/lib/api';
import {
  initSodium,
  loadKeyPair,
  openSealedFileKey,
  decryptFile,
  generateFileKey,
  encryptFileKey,
  encryptMetadata,
} from '@neutrino/e2e-crypto';
import { generateThumbnail } from '@neutrino/api-photos';
import type { FileItem } from '@neutrino/api-drive';

/**
 * Folder that local and linked images are uploaded into. Created for new
 * accounts by the backend at registration (`ATTACHMENTS_FOLDER_NAME` in
 * `src/auth/api.rs`); `ensureAttachmentsFolder` creates it on demand for
 * accounts that predate that, so the two must stay in step.
 */
export const ATTACHMENTS_FOLDER_NAME = 'Attachments';

const SCHEME = 'neutrino-drive:';

// ── The reference itself ────────────────────────────────────────────────────

/** Builds the string a document stores in place of an image. */
export function driveImageRef(fileId: string): string {
  return `${SCHEME}${fileId}`;
}

/** Returns the Drive file id a src refers to, or null if it isn't a reference. */
export function parseDriveImageRef(src: string | null | undefined): string | null {
  if (typeof src !== 'string' || !src.startsWith(SCHEME)) return null;
  const id = src.slice(SCHEME.length).trim();
  return id || null;
}

// ── Current user ────────────────────────────────────────────────────────────

/**
 * The signed-in user's id, read from the access token's `sub` claim.
 *
 * Decryption needs it (session keys are held per user) and this module is
 * called from render paths and plain functions where a React hook isn't
 * available, so it comes from the token rather than from `useUser`.
 */
function currentUserId(): string | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('access_token');
  if (!token || token === 'undefined' || token === 'null') return null;
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded)).sub ?? null;
  } catch {
    return null;
  }
}

// ── Attachments folder ──────────────────────────────────────────────────────

let attachmentsFolder: Promise<string> | null = null;

/**
 * Resolves the Attachments folder id, creating the folder if this account
 * doesn't have one. Memoised for the session — every image inserted would
 * otherwise re-list the Drive root.
 */
export function ensureAttachmentsFolder(): Promise<string> {
  if (!attachmentsFolder) {
    attachmentsFolder = findOrCreateAttachmentsFolder().catch((e) => {
      // Don't cache a failure: an upload that failed because the user was
      // offline should be able to succeed on the next try.
      attachmentsFolder = null;
      throw e;
    });
  }
  return attachmentsFolder;
}

async function findOrCreateAttachmentsFolder(): Promise<string> {
  const userId = currentUserId();
  if (!userId) throw new Error('You need to be signed in to add images.');

  // The Drive root has no folder row of its own; its id is the user's id.
  const root = await filesystemApi.getFolderContents(userId);
  const existing = root.folders.find(
    (f) => f.name.toLowerCase() === ATTACHMENTS_FOLDER_NAME.toLowerCase(),
  );
  if (existing) return existing.id;

  const created = await filesystemApi.createFolder({ name: ATTACHMENTS_FOLDER_NAME });
  return created.id;
}

// ── Getting images into Drive ───────────────────────────────────────────────

/**
 * Uploads a local file into Attachments and returns the stored Drive file.
 *
 * An image inserted into a document is a Drive file like any other, so it is
 * encrypted like any other: same rule as `UploadZone`, encrypt whenever this
 * browser holds the user's keypair and fall back to a plaintext upload only
 * when it doesn't (a locked or key-less session, where the alternative is
 * failing the insert). Nothing on the read side has to change — a reference
 * resolves through `fetchDriveImageBlob`, which decrypts when the file is
 * encrypted and passes the bytes through when it isn't.
 */
export async function uploadAttachment(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<FileItem> {
  const folderId = await ensureAttachmentsFolder();

  const userId = currentUserId();
  const keyPair = userId ? loadKeyPair(userId) : null;
  if (!keyPair) return storageApi.uploadFile(file, onProgress, folderId);

  await initSodium();
  const dek = generateFileKey();
  const encryptedFileKey = encryptFileKey(dek, keyPair.publicKey);
  const encryptedMetadata = encryptMetadata(
    { name: file.name, mimeType: file.type || 'application/octet-stream' },
    dek,
  );
  // The server cannot make a preview of a file it cannot decrypt, so the
  // thumbnail the picker grid and the Drive grid browse off is made here.
  const thumbnailB64 = await generateThumbnail(file);

  return uploadEncryptedFile(
    file,
    dek,
    encryptedFileKey,
    encryptedMetadata,
    onProgress,
    folderId,
    thumbnailB64,
  );
}

/** Derives a sensible file name for an image linked by URL. */
function fileNameFromUrl(url: string): string {
  try {
    const { pathname } = new URL(url);
    const last = pathname.split('/').filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch {
    // Not a parseable URL — fall through to the generic name.
  }
  return 'image';
}

/**
 * Copies an image at a URL into Attachments, so the document references a file
 * that will still be there when the original link rots.
 *
 * The fetch happens in the browser, which means the remote host has to allow
 * cross-origin reads. Plenty don't, and the failure is opaque by design (the
 * browser won't say why), so it is reported as what the user can act on.
 */
export async function importUrlAttachment(
  url: string,
  onProgress?: (percent: number) => void,
): Promise<FileItem> {
  let blob: Blob;
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) {
      throw new Error(`The image could not be downloaded (HTTP ${response.status}).`);
    }
    blob = await response.blob();
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('The image could not be downloaded')) throw e;
    throw new Error(
      "That site doesn't allow images to be copied from it. Download the image and add it from the Local File tab.",
    );
  }

  if (!blob.type.startsWith('image/')) {
    throw new Error('That address does not point at an image.');
  }

  const file = new File([blob], fileNameFromUrl(url), { type: blob.type });
  return uploadAttachment(file, onProgress);
}

// ── Resolving a reference back into something displayable ───────────────────

/**
 * Cached per file id and shared by every surface that renders the image —
 * an editor, its thumbnails, an export — so a photo used on ten slides is
 * downloaded and decrypted once.
 */
const metadata = new Map<string, Promise<FileItem>>();
/** Resolved srcs, readable synchronously by render paths (`peekDriveImageUrl`). */
const settled = new Map<string, string>();
const blobs = new Map<string, Promise<Blob>>();
const objectUrls = new Map<string, Promise<string>>();

/**
 * Drops everything cached for the current session — image bytes and the
 * Attachments folder id alike. Both are per-user, so this must run on sign-out:
 * the next user's Attachments folder is a different folder, and their session
 * cannot decrypt the previous user's images.
 */
export function clearDriveImageCache(): void {
  for (const pending of objectUrls.values()) {
    pending.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  }
  metadata.clear();
  blobs.clear();
  objectUrls.clear();
  settled.clear();
  attachmentsFolder = null;
}

/** Memoises a promise in `cache`, and forgets it if it rejects. */
function memo<T>(cache: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  let pending = cache.get(key);
  if (!pending) {
    pending = make().catch((e) => {
      // A failure is never cached — an image that failed while the session was
      // locked, or the network was down, must be retryable.
      cache.delete(key);
      throw e;
    });
    cache.set(key, pending);
  }
  return pending;
}

function fileMetadata(fileId: string): Promise<FileItem> {
  return memo(metadata, fileId, () => storageApi.getFileMetadata(fileId));
}

function imageMimeType(file: FileItem): string {
  return file.mimeType?.startsWith('image/') ? file.mimeType : 'image/png';
}

async function fetchDriveImageBlob(fileId: string): Promise<Blob> {
  const [file, blob] = await Promise.all([
    fileMetadata(fileId),
    storageApi.downloadFile(fileId),
  ]);

  const mimeType = imageMimeType(file);
  if (!file.encryptedMetadata) return new Blob([blob], { type: mimeType });

  // Encrypted: the download is ciphertext and only this browser holds the key.
  const userId = currentUserId();
  if (!userId || !loadKeyPair(userId)) {
    throw new Error('Unlock your encryption keys to see this image.');
  }

  await initSodium();
  const keyRef = await encryptionApi.getFileKey(fileId);
  // Flagged as encrypted but no key is stored for us — take the bytes as they are.
  if (!keyRef) return new Blob([blob], { type: mimeType });

  const dek = openSealedFileKey(userId, keyRef.encryptedFileKey, keyRef.keyVersion);
  const plain = decryptFile(new Uint8Array(await blob.arrayBuffer()), dek);
  return new Blob([plain.buffer as ArrayBuffer], { type: mimeType });
}

/** The image's bytes, decrypted when the file is E2EE. */
function resolveDriveImageBlob(fileId: string): Promise<Blob> {
  return memo(blobs, fileId, () => fetchDriveImageBlob(fileId));
}

/**
 * A src for displaying the image.
 *
 * An unencrypted file resolves to its download URL and is never pulled into
 * memory — the browser streams and caches it like any other image. Only an
 * encrypted file has to be downloaded and decrypted here, and that becomes an
 * object URL rather than a data URL: these go into live `<img>` elements, where
 * a blob reference costs a pointer and base64 costs a copy per element.
 */
export function resolveDriveImageUrl(fileId: string): Promise<string> {
  return memo(objectUrls, fileId, async () => {
    const file = await fileMetadata(fileId);
    const url = file.encryptedMetadata
      ? URL.createObjectURL(await resolveDriveImageBlob(fileId))
      : storageApi.getFileDownloadUrl(fileId);
    settled.set(fileId, url);
    return url;
  });
}

/**
 * Already-resolved src for a file, or undefined if it hasn't resolved yet.
 *
 * Rendering is synchronous — a ProseMirror decoration or a React render has to
 * say what the src is *now* — so resolution is kicked off separately and this
 * is what the render reads.
 */
export function peekDriveImageUrl(fileId: string): string | undefined {
  return settled.get(fileId);
}

/** A 1×1 transparent GIF, shown in place of an image that hasn't resolved yet. */
export const BLANK_IMAGE =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Resolves a stored src of any kind; non-references are returned unchanged. */
export async function resolveImageSrc(src: string): Promise<string> {
  const fileId = parseDriveImageRef(src);
  return fileId ? resolveDriveImageUrl(fileId) : src;
}

/**
 * A data URL for the image — needed where the bytes have to outlive the page
 * or travel into another document, as in an export.
 */
export async function resolveDriveImageDataUrl(fileId: string): Promise<string> {
  const blob = await resolveDriveImageBlob(fileId);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Rewrites every Drive reference in a fragment of HTML into a data URL.
 * Used on the way out — an export or a print window has no way to resolve a
 * `neutrino-drive:` src for itself.
 */
export async function inlineDriveImagesInHtml(html: string): Promise<string> {
  const ids = [...new Set([...html.matchAll(/neutrino-drive:([A-Za-z0-9-]+)/g)].map((m) => m[1]))];
  if (ids.length === 0) return html;

  const resolved = await Promise.all(
    ids.map(async (id) => {
      try {
        return [id, await resolveDriveImageDataUrl(id)] as const;
      } catch {
        // One unreadable image must not fail the whole export; it is left as
        // the reference, which renders as a broken image rather than nothing.
        return [id, null] as const;
      }
    }),
  );

  let out = html;
  for (const [id, dataUrl] of resolved) {
    if (dataUrl) out = out.split(driveImageRef(id)).join(dataUrl);
  }
  return out;
}
