import { type RemoteFile, type VaultRemote, VaultRemoteError } from '../sync/vaultSync';

export class NetworkError extends Error {}

/**
 * An in-memory Drive with Drive's semantics: `content_version` bumps on every content write,
 * guarded writes fail with `conflict` when stale, and missing files are `notFound`.
 * `failEvery` makes every n-th call throw a network error, to interrupt syncs mid-pass.
 */
export class FakeDrive implements VaultRemote {
  files = new Map<string, { path: string; data: Uint8Array; version: number }>();
  private nextID = 1;
  failEvery: number | null = null;
  /** Files whose download fails as content this device can't decrypt. */
  unreadable = new Set<string>();
  private calls = 0;

  private maybeFail(): void {
    this.calls++;
    if (this.failEvery && this.calls % this.failEvery === 0) throw new NetworkError('network connection lost');
  }

  async list(): Promise<RemoteFile[]> {
    this.maybeFail();
    return [...this.files].map(([id, f]) => ({ id, path: f.path, version: f.version })).sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  async download(id: string) {
    this.maybeFail();
    const f = this.files.get(id);
    if (!f) throw new VaultRemoteError('notFound');
    if (this.unreadable.has(id)) throw new VaultRemoteError('unreadable');
    return { data: f.data, version: f.version };
  }

  async create(path: string, data: Uint8Array): Promise<RemoteFile> {
    this.maybeFail();
    const id = `f${this.nextID++}`;
    this.files.set(id, { path, data, version: 1 });
    return { id, path, version: 1 };
  }

  async replace(id: string, data: Uint8Array, expectedVersion: number): Promise<number> {
    this.maybeFail();
    const f = this.files.get(id);
    if (!f) throw new VaultRemoteError('notFound');
    if (f.version !== expectedVersion) throw new VaultRemoteError('conflict');
    f.data = data;
    f.version++;
    return f.version;
  }

  async move(id: string, path: string): Promise<void> {
    this.maybeFail();
    const f = this.files.get(id);
    if (!f) throw new VaultRemoteError('notFound');
    f.path = path;
  }

  async delete(id: string): Promise<void> {
    this.maybeFail();
    if (!this.files.delete(id)) throw new VaultRemoteError('notFound');
  }

  /** What the server holds, as path → text. Two files at one path show as "DUPLICATE". */
  get snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of this.files.values()) out[f.path] = f.path in out ? 'DUPLICATE' : text(f.data);
    return out;
  }
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);
