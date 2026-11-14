/**
 * Folder links that anyone can read and write through (#321).
 *
 * Two sides live here.
 *
 * **The guest's**, on `/share`: someone holding the link and, when it has one, the password. Their
 * requests carry the guest session's bearer token explicitly and `auth: 'none'`, so a signed-in
 * user opening a link in the same browser keeps their own session untouched, and a 401 means "this
 * link session has ended", never "sign in again". Files are opened with the link key — the seed in
 * the URL fragment — and new files are sealed to the folder's owner and to the link.
 *
 * **The owner's**, in the Share dialog: `sealFolderLinkKeys` seals every encrypted file under the
 * folder that the link cannot open yet. It runs when the link is created and whenever the dialog
 * opens, which also picks up files a client added without sealing to the link itself.
 */

import { request } from '@neutrino/api-core';
import { encryptionApi, openFileKey, sealBytes, sharingApi } from './client';
import type {
  FileItem,
  FileKeyResponse,
  Folder,
  GuestSessionResponse,
  KeyRecipient,
  LinkFolderContents,
} from './types';

/** A guest session plus the link key that came with the URL. */
export interface LinkSession {
  session: GuestSessionResponse;
  /** The base64url seed from the URL fragment. */
  seed: string;
}

function guestInit(s: LinkSession, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${s.session.accessToken}`,
    },
  };
}

function guest<T>(s: LinkSession, path: string, init: RequestInit = {}, blob = false): Promise<T> {
  return request<T>(path, guestInit(s, init), {
    auth: 'none',
    ...(blob ? { responseType: 'blob' as const } : {}),
  });
}

export const linkFolderApi = {
  contents(s: LinkSession, folderId: string): Promise<LinkFolderContents> {
    return guest(s, `/api/v1/share/folder/${folderId}`);
  },

  createFolder(s: LinkSession, parentId: string, name: string): Promise<Folder> {
    return guest(s, `/api/v1/share/folder/${parentId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  updateFile(
    s: LinkSession,
    fileId: string,
    body: { name?: string; folderId?: string },
  ): Promise<FileItem> {
    return guest(s, `/api/v1/share/files/${fileId}`, { method: 'PATCH', body: JSON.stringify(body) });
  },

  updateFolder(
    s: LinkSession,
    folderId: string,
    body: { name?: string; parentId?: string },
  ): Promise<Folder> {
    return guest(s, `/api/v1/share/folders/${folderId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  trashFile(s: LinkSession, fileId: string): Promise<void> {
    return guest(s, `/api/v1/share/files/${fileId}`, { method: 'DELETE' });
  },

  trashFolder(s: LinkSession, folderId: string): Promise<void> {
    return guest(s, `/api/v1/share/folders/${folderId}`, { method: 'DELETE' });
  },
};

/** Whether the URL's key is the one this link was made with. A mismatch opens nothing. */
export async function linkKeyMatches(s: LinkSession): Promise<boolean> {
  if (!s.session.publicKey) return false;
  const { linkPublicKey } = await import('@neutrino/e2e-crypto');
  try {
    return (await linkPublicKey(s.seed)) === s.session.publicKey;
  } catch {
    return false;
  }
}

/**
 * A file's plaintext, opened with the link key. Null for a file the link holds no key for yet
 * (added since the owner last opened the Share dialog) — say so rather than show ciphertext. A file
 * with no key at all is plaintext and comes back as stored.
 */
export async function readLinkFile(
  s: LinkSession,
  file: Pick<FileItem, 'id' | 'encryptedMetadata'>,
): Promise<Uint8Array | null> {
  const blob = await guest<Blob>(s, `/api/v1/drive/files/${file.id}`, {}, true);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!file.encryptedMetadata) return bytes;

  const keyRef = await guest<FileKeyResponse>(s, `/api/v1/drive/files/${file.id}/key`).catch(
    () => null,
  );
  if (!keyRef) return null;
  const { initSodium, openLinkFileKey, decryptFile } = await import('@neutrino/e2e-crypto');
  await initSodium();
  const dek = await openLinkFileKey(s.seed, keyRef.encryptedFileKey);
  return decryptFile(bytes, dek);
}

/**
 * Upload a file into a folder of the link, encrypted in this browser.
 *
 * The file is stored in the owner's Drive, so its DEK is sealed to the **owner** in the upload
 * itself (the server checks the key version against the owner's keyring), then to this link and
 * to any other link covering the folder, so the guest can open what they just added.
 */
export async function uploadToLinkFolder(
  s: LinkSession,
  folderId: string,
  file: File,
): Promise<FileItem> {
  const recipients = await guest<{ recipients: KeyRecipient[] }>(
    s,
    `/api/v1/drive/folders/${folderId}/key-recipients`,
  ).then((r) => r.recipients);
  const owner = recipients.find((r) => r.kind === 'owner');
  if (!owner) {
    throw new Error("This folder's owner has not set up encryption, so files cannot be added here.");
  }

  const { initSodium, generateFileKey, encryptFileKey, encryptMetadata, fromBase64url, linkPublicKey } =
    await import('@neutrino/e2e-crypto');
  await initSodium();
  const dek = generateFileKey();
  const mimeType = file.type || 'application/octet-stream';
  const cipher = await sealBytes(new Uint8Array(await file.arrayBuffer()), dek);

  const form = new FormData();
  form.append('folder_id', folderId);
  form.append('encrypted_metadata', encryptMetadata({ name: file.name, mimeType }, dek));
  form.append('mime_type', mimeType);
  form.append('encrypted_file_key', encryptFileKey(dek, fromBase64url(owner.publicKey)));
  form.append('key_version', String(owner.keyVersion));
  form.append(
    'file',
    new File([new Blob([cipher.buffer as ArrayBuffer])], file.name, {
      type: 'application/octet-stream',
    }),
  );
  const item = await guest<FileItem>(s, '/api/v1/share/folder/upload', { method: 'POST', body: form });

  const mine = { recipientId: s.session.keySubject, publicKey: await linkPublicKey(s.seed), keyVersion: 1 };
  for (const r of [mine, ...recipients.filter((r) => r.kind === 'link')]) {
    await guest(s, `/api/v1/drive/files/${item.id}/key/share`, {
      method: 'POST',
      body: JSON.stringify({
        recipientId: r.recipientId,
        encryptedFileKey: encryptFileKey(dek, fromBase64url(r.publicKey)),
        keyVersion: r.keyVersion,
      }),
    });
  }
  return item;
}

export interface SealLinkKeysResult {
  sealed: number;
  /** Files the owner's own key does not open (someone else's upload) or that failed. */
  skipped: number;
}

/**
 * Seal every encrypted file under `folderId` that its link cannot open yet. Owner only; needs the
 * owner's unlocked keypair. Pages through `unkeyed-files` until nothing is left or a page makes
 * no progress.
 */
export async function sealFolderLinkKeys(
  userId: string,
  folderId: string,
): Promise<SealLinkKeysResult> {
  const { initSodium, encryptFileKey, fromBase64url } = await import('@neutrino/e2e-crypto');
  await initSodium();
  const result: SealLinkKeysResult = { sealed: 0, skipped: 0 };
  const tried = new Set<string>();

  for (;;) {
    const page = await sharingApi.getUnkeyedFiles(folderId);
    if (!page.publicKey) return result;
    const linkKey = fromBase64url(page.publicKey);
    const fresh = page.fileIds.filter((id) => !tried.has(id));
    if (fresh.length === 0) return result;

    for (const fileId of fresh) {
      tried.add(fileId);
      try {
        const keyRef = await encryptionApi.getFileKey(fileId);
        if (!keyRef) {
          result.skipped++;
          continue;
        }
        const dek = await openFileKey(userId, fileId, keyRef);
        await encryptionApi.shareFileKey(fileId, {
          recipientId: page.keySubject,
          encryptedFileKey: encryptFileKey(dek, linkKey),
          keyVersion: 1,
        });
        result.sealed++;
      } catch (e) {
        console.warn('[sealFolderLinkKeys] skipped', fileId, e);
        result.skipped++;
      }
    }
    if (!page.hasMore) return result;
  }
}
