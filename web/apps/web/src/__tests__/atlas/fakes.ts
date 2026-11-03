/** In-memory stand-ins for Drive, the browser's vault copies and its settings, for `/atlas`'s tests. */
import { vi } from 'vitest';
import { MemoryStorage, Vault, VaultInUseError, VaultRemoteError, type RemoteFile, type VaultRemote } from '@neutrino/atlas';
import type { AtlasServices, DriveItem } from '@/app/(apps)/atlas/atlasModel';

/** Drive, in memory: content versions guard writes, as the server's do. */
export class MemoryDrive implements VaultRemote {
  files = new Map<string, { path: string; data: Uint8Array; version: number }>();
  private next = 1;
  async list(): Promise<RemoteFile[]> {
    return [...this.files].map(([id, f]) => ({ id, path: f.path, version: f.version }));
  }
  async download(id: string) {
    const f = this.files.get(id);
    if (!f) throw new VaultRemoteError('notFound');
    return { data: f.data, version: f.version };
  }
  async create(path: string, data: Uint8Array): Promise<RemoteFile> {
    const id = `f${this.next++}`;
    this.files.set(id, { path, data, version: 1 });
    return { id, path, version: 1 };
  }
  async replace(id: string, data: Uint8Array, expected: number): Promise<number> {
    const f = this.files.get(id);
    if (!f) throw new VaultRemoteError('notFound');
    if (f.version !== expected) throw new VaultRemoteError('conflict');
    f.data = data;
    return ++f.version;
  }
  async move(id: string, path: string): Promise<void> {
    const f = this.files.get(id);
    if (!f) throw new VaultRemoteError('notFound');
    f.path = path;
  }
  async delete(id: string): Promise<void> {
    this.files.delete(id);
  }
  text(path: string): string | undefined {
    const f = [...this.files.values()].find((x) => x.path === path);
    return f && new TextDecoder().decode(f.data);
  }
}

export class MemorySettings {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

/** A PNG's first bytes: enough for an image's type to be known from them. */
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The rest of the user's Drive, outside the vault, by folder id ("u1" is the root): a photo, a
 * document with a thumbnail, and a folder.
 */
export const DRIVE_FILES: Record<string, DriveItem[]> = {
  u1: [
    { id: 'v1', name: 'Atlas', isFolder: true, mimeType: null },
    { id: 'pics', name: 'Pictures', isFolder: true, mimeType: null },
    { id: 'doc1', name: 'Q4 plan.docx', isFolder: false, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  ],
  pics: [{ id: 'img1', name: 'Beach.png', isFolder: false, mimeType: 'image/png' }],
};

/** One browser: its key, its vault copies (one tab at a time each), its settings. */
export function browser(drive: MemoryDrive, { hasKey = true } = {}) {
  const copies = new Map<string, MemoryStorage>();
  const open = new Set<string>();
  const opened: string[] = [];
  const services: AtlasServices = {
    canEncrypt: async () => hasKey,
    openVault: async (_user, id) => {
      if (open.has(id)) throw new VaultInUseError();
      if (!copies.has(id)) copies.set(id, new MemoryStorage());
      open.add(id);
      opened.push(id);
      return { vault: await Vault.open(copies.get(id)!), indexCache: null, close: async () => void open.delete(id) };
    },
    discardVault: async (_user, id) => void copies.delete(id),
    remote: () => drive,
    rootFolders: async () => [{ id: 'v1', name: 'Atlas' }, { id: 'v2', name: 'Work' }],
    createVault: async () => 'v-new',
    settings: new MemorySettings(),
    openURL: vi.fn(),
    driveFolder: async (id) => DRIVE_FILES[id] ?? [],
    readDriveImage: async () => new Blob([PNG], { type: 'image/png' }),
    filePreview: async (id) => (id === 'doc1' ? new Blob([PNG], { type: 'image/png' }) : null),
  };
  return { services, opened, open };
}
