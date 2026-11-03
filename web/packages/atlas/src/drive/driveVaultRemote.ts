import { ApiClientError, request } from '@neutrino/api-core';
import { MissingEncryptionKeyError, encryptionApi, openFileKey } from '@neutrino/api-drive';
import {
  activeKeyVersion,
  decryptFile,
  decryptMetadata,
  encryptFile,
  encryptFileKey,
  encryptMetadata,
  generateFileKey,
  initSodium,
  loadKeyPair,
} from '@neutrino/e2e-crypto';
import { type RemoteFile, type VaultRemote, VaultRemoteError } from '../sync/vaultSync';

interface FolderDTO {
  id: string;
  name: string;
}
interface FileDTO {
  id: string;
  name: string;
  contentVersion: number;
  encryptedMetadata?: string | null;
}
interface FolderContentsDTO {
  folders: FolderDTO[];
  files: FileDTO[];
}

/**
 * A vault on Neutrino Drive: AtlasKit's `DriveVaultRemote`, for the browser. The vault is a
 * Drive folder; its subfolders and files mirror the vault's paths with real names
 * (neutrino-atlas.md, constraint 1). Every file's content is end-to-end encrypted with
 * `@neutrino/e2e-crypto`, exactly as Drive's other clients do it:
 * - a fresh DEK per file, sealed to the account's active public key and sent with the upload;
 * - content encrypted with the DEK;
 * - `encrypted_metadata` holding the name and MIME type.
 *
 * Keys come from the session keyring of `userId`; with none, writes throw
 * `MissingEncryptionKeyError` (no key, no write) and reads of a file report it unreadable.
 *
 * Writes are guarded by `content_version` (`?expectedContentVersion=`): a 409 becomes
 * `VaultRemoteError('conflict')` for `VaultSync` to merge.
 */
export class DriveVaultRemote implements VaultRemote {
  /** Folder ids by vault path; "" is the vault folder itself. */
  private folderIDs = new Map<string, string>();
  /** Folders whose child folders have been listed, so `ensureFolder` doesn't create a duplicate. */
  private listedFolders = new Set<string>();
  /** File names by id, which autosave needs. */
  private names = new Map<string, string>();
  /** Opened DEKs by file id. */
  private deks = new Map<string, Uint8Array>();

  constructor(
    readonly userId: string,
    readonly vaultFolderID: string,
  ) {
    this.folderIDs.set('', vaultFolderID);
  }

  /** Creates a vault: a new folder in the root of the user's Drive. Returns its id. */
  static async createVault(name: string): Promise<string> {
    const folder = await call<FolderDTO>('POST', '/api/v1/drive/folders', { name });
    return folder.id;
  }

  /**
   * The folders at the root of the user's Drive: where a vault can be chosen from. The root has
   * no id of its own; the user's id addresses it.
   */
  static async rootFolders(userId: string): Promise<FolderDTO[]> {
    const contents = await call<FolderContentsDTO>('GET', `/api/v1/drive/folders/${userId}`);
    return contents.folders
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  // ── VaultRemote ──────────────────────────────────────────────────────────────

  async list(): Promise<RemoteFile[]> {
    const files: RemoteFile[] = [];
    const queue: { id: string; path: string }[] = [{ id: this.vaultFolderID, path: '' }];
    this.folderIDs = new Map([['', this.vaultFolderID]]);
    this.listedFolders = new Set();
    while (queue.length) {
      const { id, path } = queue.shift()!;
      const contents = await call<FolderContentsDTO>('GET', `/api/v1/drive/folders/${id}`);
      this.listedFolders.add(path);
      for (const folder of contents.folders) {
        const childPath = join(path, folder.name);
        this.folderIDs.set(childPath, folder.id);
        queue.push({ id: folder.id, path: childPath });
      }
      for (const file of contents.files) {
        this.names.set(file.id, file.name);
        files.push({ id: file.id, path: join(path, file.name), version: file.contentVersion });
      }
    }
    return files;
  }

  async download(id: string): Promise<{ data: Uint8Array; version: number }> {
    await initSodium();
    // The version is read before and after the content: a write landing in between would pair
    // new bytes with an old version, so retry until both agree.
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await call<FileDTO>('GET', `/api/v1/drive/files/${id}/info`);
      this.names.set(id, before.name);
      const dek = await this.dek(id);
      const ciphertext = await bytes(`/api/v1/drive/files/${id}`);
      const after = await call<FileDTO>('GET', `/api/v1/drive/files/${id}/info`);
      if (before.contentVersion !== after.contentVersion) continue;
      this.names.set(id, after.name);
      try {
        const metadata = after.encryptedMetadata ? decryptMetadata(after.encryptedMetadata, dek) : {};
        // Chunked content (`chunkSize` in the metadata) is written by Photos for large media;
        // the web's crypto can't read it yet, so it's left out like any unreadable file.
        if (metadata.chunkSize !== undefined) throw new Error(`chunked content (${String(metadata.chunkSize)})`);
        return { data: decryptFile(ciphertext, dek), version: after.contentVersion };
      } catch (e) {
        console.error(`[atlas] ${after.name} (${id}): its key opens but its content doesn't decrypt`, e);
        throw new VaultRemoteError('unreadable', `${after.name} can't be decrypted`);
      }
    }
    throw new VaultRemoteError('conflict');
  }

  async create(path: string, data: Uint8Array): Promise<RemoteFile> {
    const active = await this.activeKey();
    const [parent, name] = split(path);
    const folderID = await this.ensureFolder(parent);
    const dek = generateFileKey();
    const mimeType = mimeTypeFor(name);
    const form = new FormData();
    form.append('folder_id', folderID);
    form.append('encrypted_metadata', encryptMetadata({ name, mimeType }, dek));
    form.append('mime_type', mimeType);
    form.append('encrypted_file_key', encryptFileKey(dek, active.publicKey));
    form.append('key_version', String(active.version));
    form.append('file', new Blob([buffer(encryptFile(data, dek))], { type: 'application/octet-stream' }), name);
    const file = await call<FileDTO>('POST', '/api/v1/drive/files/upload', form);
    this.deks.set(file.id, dek);
    this.names.set(file.id, name);
    return { id: file.id, path, version: file.contentVersion };
  }

  async replace(id: string, data: Uint8Array, expectedVersion: number): Promise<number> {
    await initSodium();
    const dek = await this.dek(id);
    // No `metadata` part: autosave would apply its title as a rename, and the name is managed
    // by `move`.
    const form = new FormData();
    form.append('file', new Blob([buffer(encryptFile(data, dek))], { type: 'application/octet-stream' }), this.names.get(id) ?? 'file');
    const file = await call<FileDTO>('PUT', `/api/v1/drive/files/${id}/autosave?expectedContentVersion=${expectedVersion}`, form);
    return file.contentVersion;
  }

  async move(id: string, path: string): Promise<void> {
    const [parent, name] = split(path);
    const folderID = await this.ensureFolder(parent);
    await call<FileDTO>('PATCH', `/api/v1/drive/files/${id}`, { name, folderId: folderID });
    this.names.set(id, name);
  }

  async delete(id: string): Promise<void> {
    await call<void>('DELETE', `/api/v1/drive/files/${id}`, undefined, 'none');
    this.deks.delete(id);
    this.names.delete(id);
  }

  // ── Keys and folders ─────────────────────────────────────────────────────────

  private async activeKey(): Promise<{ publicKey: Uint8Array; version: number }> {
    await initSodium();
    const pair = loadKeyPair(this.userId);
    if (!pair) throw new MissingEncryptionKeyError();
    return { publicKey: pair.publicKey, version: activeKeyVersion(this.userId) ?? 1 };
  }

  /**
   * A file's DEK, opened with whichever of the session's keys seals it; a key filed under the
   * wrong version is filed again (api-drive's `openFileKey`). A file with no key held here, or
   * none at all, is unreadable.
   */
  private async dek(id: string): Promise<Uint8Array> {
    const cached = this.deks.get(id);
    if (cached) return cached;
    const ref = await remoteErrors(() => encryptionApi.getFileKey(id));
    if (!ref) throw new VaultRemoteError('unreadable', `${this.names.get(id) ?? id} has no key`);
    let dek: Uint8Array;
    try {
      dek = await openFileKey(this.userId, id, ref);
    } catch (e) {
      console.error(`[atlas] Key for ${this.names.get(id) ?? id} (${id}) opens with none of the keys held here`, e);
      throw new VaultRemoteError('unreadable', e instanceof Error ? e.message : String(e));
    }
    this.deks.set(id, dek);
    return dek;
  }

  /** The id of the folder at vault path `path`, creating it and any parents that don't exist. */
  private async ensureFolder(path: string): Promise<string> {
    const known = this.folderIDs.get(path);
    if (known) return known;
    const [parentPath, name] = split(path);
    const parentID = await this.ensureFolder(parentPath);
    if (!this.listedFolders.has(parentPath)) {
      const contents = await call<FolderContentsDTO>('GET', `/api/v1/drive/folders/${parentID}`);
      this.listedFolders.add(parentPath);
      for (const folder of contents.folders) this.folderIDs.set(join(parentPath, folder.name), folder.id);
      const found = this.folderIDs.get(path);
      if (found) return found;
    }
    const folder = await call<FolderDTO>('POST', '/api/v1/drive/folders', { name, parentId: parentID });
    this.folderIDs.set(path, folder.id);
    this.listedFolders.add(path); // brand new: no children
    return folder.id;
  }
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

/**
 * One API request. Statuses map onto `VaultRemoteError` where sync cares: 409 is a lost race,
 * 404 a file gone elsewhere. api-core refreshes the token on a 401.
 */
function call<T>(method: string, path: string, body?: FormData | object, responseType?: 'none'): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) init.body = JSON.stringify(body);
  return remoteErrors(() => request<T>(path, init, responseType ? { responseType } : {}));
}

async function bytes(path: string): Promise<Uint8Array> {
  const blob = await remoteErrors(() => request<Blob>(path, {}, { responseType: 'blob' }));
  return new Uint8Array(await blob.arrayBuffer());
}

async function remoteErrors<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (e) {
    if (e instanceof ApiClientError && e.statusCode === 404) throw new VaultRemoteError('notFound', e.message);
    if (e instanceof ApiClientError && e.statusCode === 409) throw new VaultRemoteError('conflict', e.message);
    throw e;
  }
}

// ── Paths ─────────────────────────────────────────────────────────────────────

export const join = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);

/** `['Folder/Sub', 'Page.md']` for `Folder/Sub/Page.md`; the parent is "" at the vault root. */
export function split(path: string): [string, string] {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? ['', path] : [path.slice(0, slash), path.slice(slash + 1)];
}

export function mimeTypeFor(name: string): string {
  const dot = name.lastIndexOf('.');
  switch (dot < 0 ? '' : name.slice(dot + 1).toLowerCase()) {
    case 'md':
      return 'text/markdown';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'pdf':
      return 'application/pdf';
    case 'txt':
      return 'text/plain';
    case 'json':
    case 'canvas':
      return 'application/json';
    default:
      return 'application/octet-stream';
  }
}

function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
