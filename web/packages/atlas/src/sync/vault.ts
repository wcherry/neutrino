/** What sync knows about one file of the vault. */
export interface SyncRecord {
  /** Where the file is now, locally (vault-relative, `/`-separated, with its extension). */
  path: string;
  /** The Drive file it is synced with; null until its first upload. */
  fileID: string | null;
  /** The server `content_version` this device last synced the file at. */
  baseVersion: number | null;
  /** The path the server had at that sync. Differs from `path` after a local move. */
  basePath: string | null;
  /** Changed locally since the last sync. */
  dirty: boolean;
  /** Deleted locally; the deletion hasn't reached the server yet. */
  deleted: boolean;
}

export function syncRecord(path: string, fields: Partial<Omit<SyncRecord, 'path'>> = {}): SyncRecord {
  return { path, fileID: null, baseVersion: null, basePath: null, dirty: false, deleted: false, ...fields };
}

/**
 * Where a vault keeps its bytes in this browser. `IndexedDBStorage` seals everything, so no
 * plaintext reaches the disk (neutrino-atlas.md, constraint 1).
 */
export interface VaultStorage {
  read(key: string): Promise<Uint8Array | null>;
  write(data: Uint8Array, key: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Appends one entry to the journal. */
  appendToJournal(entry: Uint8Array): Promise<void>;
  /**
   * Every journal entry, oldest first. An entry that won't open throws: that is a wrong key or
   * corruption, and nothing may be discarded.
   */
  readJournal(): Promise<Uint8Array[]>;
  clearJournal(): Promise<void>;
}

/** The persisted map from paths to blobs, and the sync records. */
interface Manifest {
  records: Record<string, SyncRecord>; // by path
  content: Record<string, string>; // path → blob key
  base: Record<string, string>; // fileID → blob key
}

/**
 * One change to the manifest, as appended to the journal. Values are absolute (null removes),
 * so replaying an entry twice is harmless.
 */
interface Delta {
  records: Record<string, SyncRecord | null>;
  content: Record<string, string | null>;
  base: Record<string, string | null>;
}

const MANIFEST_KEY = 'manifest';
const emptyDelta = (): Delta => ({ records: {}, content: {}, base: {} });
const isEmpty = (d: Delta) =>
  !Object.keys(d.records).length && !Object.keys(d.content).length && !Object.keys(d.base).length;
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const decode = <T>(bytes: Uint8Array): T => JSON.parse(new TextDecoder().decode(bytes)) as T;
const newKey = () => crypto.randomUUID().toUpperCase();

/** Applies `delta` to `target` in place; null removes. */
function apply<T>(target: Record<string, T>, delta: Record<string, T | null>): void {
  for (const [k, v] of Object.entries(delta)) {
    if (v === null) delete target[k];
    else target[k] = v;
  }
}

function applyDelta(manifest: Manifest, delta: Delta): void {
  apply(manifest.records, delta.records);
  apply(manifest.content, delta.content);
  apply(manifest.base, delta.base);
}

const copyManifest = (m: Manifest): Manifest => JSON.parse(JSON.stringify(m)) as Manifest;

/** A save failed, so this copy of the vault no longer matches what's stored: open it again. */
export class VaultStorageError extends Error {
  constructor(readonly cause: unknown) {
    super(`The vault couldn't be saved in this browser: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'VaultStorageError';
  }
}

/**
 * The local copy of a vault: every file's current content, the content it had at its last
 * sync (the base of a three-way merge), and its sync record. A port of AtlasKit's `Vault`.
 *
 * All local edits go through here, so sync always knows what changed. Each change updates the
 * in-memory manifest before its first `await`, so reads see it at once and changes made while
 * another is being saved don't interleave; the journal gets them in the order they were made.
 * If a save fails, every later change throws `VaultStorageError`: memory is then ahead of what's
 * stored, and the vault has to be opened again from storage.
 */
export class Vault {
  /** Journal entries before the manifest is rewritten in full and the journal cleared. */
  static compactionThreshold = 1_000;

  private manifest: Manifest;
  /** The manifest as journaled: what compaction writes, so it never names an unwritten blob. */
  private durable: Manifest;
  private failure: VaultStorageError | null = null;
  /** Drive file id → local path. Not persisted: rebuilt on open, kept current by `setRecord`. */
  private pathByFileID = new Map<string, string>();
  private pending: Delta = emptyDelta();
  private journalLength: number;
  /** Saves run one at a time, in order. */
  private saving: Promise<void> = Promise.resolve();

  private constructor(
    private readonly storage: VaultStorage,
    manifest: Manifest,
    journalLength: number,
  ) {
    this.manifest = manifest;
    this.durable = copyManifest(manifest);
    this.journalLength = journalLength;
    for (const [path, record] of Object.entries(manifest.records)) {
      if (record.fileID) this.pathByFileID.set(record.fileID, path);
    }
  }

  static async open(storage: VaultStorage): Promise<Vault> {
    const data = await storage.read(MANIFEST_KEY);
    const manifest: Manifest = data ? decode(data) : { records: {}, content: {}, base: {} };
    const journal = await storage.readJournal();
    for (const entry of journal) applyDelta(manifest, decode<Delta>(entry));
    return new Vault(storage, manifest, journal.length);
  }

  /**
   * Sets or removes the record at `path`, keeping the file-id index current. With
   * `setContentKey` and `setBaseKey`, the only ways the manifest changes: each change is also
   * added to the pending journal entry.
   */
  private setRecord(record: SyncRecord | null, path: string): void {
    if (this.failure) throw this.failure;
    const old = this.manifest.records[path];
    if (old?.fileID && this.pathByFileID.get(old.fileID) === path) this.pathByFileID.delete(old.fileID);
    if (record) this.manifest.records[path] = record;
    else delete this.manifest.records[path];
    if (record?.fileID) this.pathByFileID.set(record.fileID, path);
    this.pending.records[path] = record ? { ...record } : null;
  }

  private setContentKey(key: string | null, path: string): void {
    if (this.failure) throw this.failure;
    if (key) this.manifest.content[path] = key;
    else delete this.manifest.content[path];
    this.pending.content[path] = key;
  }

  private setBaseKey(key: string | null, fileID: string): void {
    if (key) this.manifest.base[fileID] = key;
    else delete this.manifest.base[fileID];
    this.pending.base[fileID] = key;
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  /** Every live file's path, sorted. */
  get paths(): string[] {
    return Object.values(this.manifest.records)
      .filter((r) => !r.deleted)
      .map((r) => r.path)
      .sort(compare);
  }

  async content(path: string): Promise<Uint8Array | null> {
    const record = this.manifest.records[path];
    const key = this.manifest.content[path];
    if (!record || record.deleted || !key) return null;
    return this.storage.read(key);
  }

  async text(path: string): Promise<string | null> {
    const data = await this.content(path);
    // A BOM stays, as in AtlasKit, so a page round-trips byte for byte.
    return data === null ? null : new TextDecoder('utf-8', { ignoreBOM: true }).decode(data);
  }

  /** Every record, by path. Copies: change them through the vault. */
  get records(): SyncRecord[] {
    return Object.values(this.manifest.records)
      .map((r) => ({ ...r }))
      .sort((a, b) => compare(a.path, b.path));
  }

  record(path: string): SyncRecord | null {
    const r = this.manifest.records[path];
    return r ? { ...r } : null;
  }

  /** The record synced with Drive file `fileID`, wherever it is now. There is at most one. */
  recordForFile(fileID: string): SyncRecord | null {
    const path = this.pathByFileID.get(fileID);
    return path === undefined ? null : this.record(path);
  }

  // ── Local edits ────────────────────────────────────────────────────────────

  /** Creates or replaces a file's content. */
  async write(data: Uint8Array, path: string): Promise<void> {
    if (this.failure) throw this.failure;
    const key = newKey();
    const stored = this.storage.write(data, key);
    const old = this.manifest.content[path] ?? null;
    this.setContentKey(key, path);
    const record = this.manifest.records[path] ?? syncRecord(path);
    this.setRecord({ ...record, dirty: true, deleted: false }, path);
    await this.save([old], [stored]);
  }

  writeText(text: string, path: string): Promise<void> {
    return this.write(new TextEncoder().encode(text), path);
  }

  /**
   * Deletes a file. A never-synced file just disappears; a synced one leaves a tombstone until
   * the deletion reaches the server.
   */
  async delete(path: string): Promise<void> {
    const record = this.manifest.records[path];
    if (!record) return;
    const old = this.manifest.content[path] ?? null;
    this.setContentKey(null, path);
    if (record.fileID === null) this.setRecord(null, path);
    else this.setRecord({ ...record, deleted: true }, path);
    await this.save([old]);
  }

  /** Renames or moves a file. Its content and sync state move with it. */
  async move(from: string, to: string): Promise<void> {
    const record = this.manifest.records[from];
    if (from === to || !record || record.deleted || this.manifest.records[to]) return;
    this.setRecord(null, from);
    this.setRecord({ ...record, path: to }, to);
    const key = this.manifest.content[from] ?? null;
    this.setContentKey(null, from);
    this.setContentKey(key, to);
    await this.save();
  }

  // ── For sync ───────────────────────────────────────────────────────────────

  /** @internal */
  async base(fileID: string): Promise<Uint8Array | null> {
    const key = this.manifest.base[fileID];
    return key ? this.storage.read(key) : null;
  }

  /**
   * @internal After a successful sync of a file: its content (null to keep what's there), its
   * base, and its record, all at once.
   */
  async commit(record: SyncRecord, content: Uint8Array | null, base: Uint8Array | null): Promise<void> {
    if (this.failure) throw this.failure;
    const stale: (string | null)[] = [];
    const stored: Promise<void>[] = [];
    if (content) {
      const key = newKey();
      stored.push(this.storage.write(content, key));
      stale.push(this.manifest.content[record.path] ?? null);
      this.setContentKey(key, record.path);
    }
    if (record.fileID && base) {
      const key = newKey();
      stored.push(this.storage.write(base, key));
      stale.push(this.manifest.base[record.fileID] ?? null);
      this.setBaseKey(key, record.fileID);
    }
    this.setRecord({ ...record }, record.path);
    await this.save(stale, stored);
  }

  /** @internal Moves a record (and its content) to another path as part of sync, without marking it dirty. */
  async relocate(from: string, to: string): Promise<void> {
    const record = this.manifest.records[from];
    if (from === to || !record) return;
    this.setRecord(null, from);
    this.setRecord({ ...record, path: to }, to);
    const key = this.manifest.content[from];
    if (key) {
      this.setContentKey(null, from);
      this.setContentKey(key, to);
    }
    await this.save();
  }

  /** @internal Forgets a file entirely: content, base and record. */
  async forget(path: string): Promise<void> {
    const record = this.manifest.records[path];
    if (!record) return;
    this.setRecord(null, path);
    const stale = [this.manifest.content[path] ?? null];
    this.setContentKey(null, path);
    if (record.fileID) {
      stale.push(this.manifest.base[record.fileID] ?? null);
      this.setBaseKey(null, record.fileID);
    }
    await this.save(stale);
  }

  /**
   * Commits the pending change by appending it to the journal, then removes blobs no longer
   * referenced. In that order, and only once the new blobs (`stored`) are written: a crash in
   * between leaves an unreferenced blob, never a manifest pointing at a missing one. Each
   * change costs one small journal entry; the full manifest is only rewritten every
   * `compactionThreshold` entries.
   *
   * The pending entry is taken synchronously, so each save journals exactly the changes made
   * before it; saves are chained so entries land in order.
   */
  private save(stale: (string | null)[] = [], stored: Promise<void>[] = []): Promise<void> {
    const entry = this.pending;
    this.pending = emptyDelta();
    // Awaited in `run`, unless an earlier save failed first: don't let that go unhandled.
    for (const write of stored) write.catch(() => {});
    const run = async () => {
      if (this.failure) throw this.failure;
      try {
        await Promise.all(stored);
        if (!isEmpty(entry)) {
          await this.storage.appendToJournal(encode(entry));
          applyDelta(this.durable, entry);
          this.journalLength++;
          if (this.journalLength >= Vault.compactionThreshold) await this.compact();
        }
      } catch (error) {
        this.failure ??= new VaultStorageError(error);
        throw this.failure;
      }
      // A blob left behind is only wasted space.
      for (const key of stale) if (key) await this.storage.remove(key).catch(() => {});
    };
    const saved = this.saving.then(run);
    this.saving = saved.catch(() => {});
    return saved;
  }

  /**
   * Writes the whole manifest and clears the journal. A crash between the two replays entries
   * the manifest already holds, which is harmless.
   */
  private async compact(): Promise<void> {
    await this.storage.write(encode(this.durable), MANIFEST_KEY);
    await this.storage.clearJournal();
    this.journalLength = 0;
  }
}

/** Plain code-unit order: deterministic, which is all listings need. */
export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Vault storage in memory, for tests and previews. */
export class MemoryStorage implements VaultStorage {
  readonly blobs = new Map<string, Uint8Array>();
  journal: Uint8Array[] = [];
  async read(key: string) {
    return this.blobs.get(key) ?? null;
  }
  async write(data: Uint8Array, key: string) {
    this.blobs.set(key, data);
  }
  async remove(key: string) {
    this.blobs.delete(key);
  }
  async appendToJournal(entry: Uint8Array) {
    this.journal.push(entry);
  }
  async readJournal() {
    return [...this.journal];
  }
  async clearJournal() {
    this.journal = [];
  }
}
