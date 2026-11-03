import { MarkdownDocument } from '../document';
import { decodeIndexCache, encodeIndexCache, type CachedPage, type IndexCacheStore } from '../indexing/indexCache';
import { VaultIndex } from '../indexing/vaultIndex';
import { LinkResolver } from '../resolve';
import { compare, type Vault } from '../sync/vault';
import { VaultSync, emptySyncReport, isQuiet, type SyncReport, type VaultRemote } from '../sync/vaultSync';

/** There's already a file where a move would put one. */
export class FileExistsError extends Error {
  constructor(readonly path: string) {
    super(`A file already exists at ${path}`);
    this.name = 'FileExistsError';
  }
}

/**
 * An open vault: its files in this browser (`Vault`), its index (`VaultIndex`), and two-way
 * sync with its remote. What the app holds while a vault is open, and the one place it reads
 * and changes pages through, so the index never falls behind the files. AtlasKit's
 * `VaultWorkspace`.
 *
 * Sync passes, moves and deletions run one at a time. Pages written while one runs are held
 * back and written to the vault when it ends: a pass commits each file only after the server
 * accepted it, and an edit slipped in under it would be recorded as already synced. Reads see
 * held edits at once, and so does the index.
 */
export class VaultWorkspace {
  readonly index = new VaultIndex();
  private readonly engine: VaultSync;

  /** A sync pass is running or waiting to. */
  isSyncing = false;
  lastSync: Date | null = null;
  /** Conflicted copies made by the last passes, until the app clears them. */
  conflicts: SyncReport['conflicts'] = [];

  /**
   * Called after anything changed the vault's files or their content: an edit, a move, a
   * deletion, or a sync pass that brought changes. `moved` maps old paths to new ones, so the
   * app can follow a page it has open.
   */
  onChange: ((moved: Map<string, string>) => void) | null = null;

  /** Edits made while an operation runs, written when it ends. */
  private pending = new Map<string, Uint8Array>();
  /** An operation (sync, move, delete) is running. */
  private busy = false;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly vault: Vault,
    remote: VaultRemote,
    private readonly cache: IndexCacheStore | null,
  ) {
    this.engine = new VaultSync(vault, remote);
  }

  /**
   * Opens a workspace on `vault`, indexing every page in it. With a `cache`, pages unchanged
   * since it was saved aren't parsed again, and the cache is brought up to date.
   */
  static async open(vault: Vault, remote: VaultRemote, cache: IndexCacheStore | null = null): Promise<VaultWorkspace> {
    const workspace = new VaultWorkspace(vault, remote, cache);
    const cached = decodeIndexCache(cache ? await cache.load().catch(() => null) : null);
    let parsed = 0;
    const pages = await Promise.all(
      vault.paths.map(async (path) => {
        if (!VaultIndex.isPage(path)) return { path, hit: null, data: null };
        const hit = cached.get(path);
        if (hit && hit.tag === vault.contentTag(path)) return { path, hit, data: null };
        parsed++;
        return { path, hit: null, data: await vault.content(path) };
      }),
    );
    workspace.index.batch(() => {
      for (const { path, hit, data } of pages) {
        if (hit) workspace.index.upsertExtracted(path, hit);
        else workspace.reindexWith(path, data);
      }
    });
    if (cache && (parsed > 0 || cached.size !== workspace.index.pageCount)) await workspace.saveIndexCache().catch(() => {});
    return workspace;
  }

  /**
   * Saves what the index extracted from every page, so the next `open` needn't parse them.
   * Runs after the operations before it, when the index matches the vault exactly. The
   * workspace saves it after sync passes that changed something; call it too when the app is
   * about to close.
   */
  saveIndexCache(): Promise<void> {
    const cache = this.cache;
    if (!cache) return Promise.resolve();
    return this.exclusively(async () => {
      const pages = new Map<string, CachedPage>();
      for (const page of this.index.indexedPages()) {
        const tag = this.vault.contentTag(page.path);
        if (tag) pages.set(page.path, { ...page, tag });
      }
      await cache.save(encodeIndexCache(pages));
    });
  }

  // ── Reading ─────────────────────────────────────────────────────────────────

  /** Every file's path, sorted: pages (`.md`) and attachments. */
  get paths(): string[] {
    if (this.pending.size === 0) return this.vault.paths;
    return [...new Set([...this.vault.paths, ...this.pending.keys()])].sort(compare);
  }

  get pages(): string[] {
    return this.paths.filter(VaultIndex.isPage);
  }

  async content(path: string): Promise<Uint8Array | null> {
    return this.pending.get(path) ?? this.vault.content(path);
  }

  async text(path: string): Promise<string | null> {
    const data = await this.content(path);
    return data === null ? null : decode(data);
  }

  contains(path: string): boolean {
    if (this.pending.has(path)) return true;
    const record = this.vault.record(path);
    return record !== null && !record.deleted;
  }

  // ── Changing ────────────────────────────────────────────────────────────────

  /** Saves a page's text (or an attachment's bytes) and re-indexes it. */
  async write(data: Uint8Array, path: string): Promise<void> {
    const current = await this.content(path);
    if (current !== null && equal(current, data)) return;
    if (this.busy) {
      this.pending.set(path, data);
    } else {
      // The vault records the change before its first await, so a pass starting meanwhile sees it.
      const written = this.vault.write(data, path);
      this.reindexWith(path, data);
      this.onChange?.(new Map());
      return written;
    }
    this.reindexWith(path, data);
    this.onChange?.(new Map());
  }

  writeText(text: string, path: string): Promise<void> {
    return this.write(new TextEncoder().encode(text), path);
  }

  /** A new page titled `title` in `folder`, numbered if the title is taken. Returns its path. */
  async createPage(title = 'Untitled', folder = '', text = ''): Promise<string> {
    const path = this.freePagePath(title, folder);
    await this.writeText(text, path);
    return path;
  }

  /** Where a new page titled `title` goes in `folder`: numbered if the title is taken, with a `/` in it made a `-`. */
  freePagePath(title: string, folder: string): string {
    const clean = title.replaceAll('/', '-').replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '');
    const base = clean === '' ? 'Untitled' : clean;
    let path = join(folder, base + '.md');
    for (let n = 2; this.contains(path); n++) path = join(folder, `${base} ${n}.md`);
    return path;
  }

  /**
   * Renames or moves a file, and rewrites the links to it across the vault (SPEC §7). Waits
   * for a running pass. Returns how many pages had links rewritten.
   */
  move(from: string, to: string): Promise<number> {
    if (from === to) return Promise.resolve(0);
    return this.exclusively(async () => {
      if (!this.contains(from)) throw new Error(`No file at ${from}`);
      if (this.contains(to)) throw new FileExistsError(to);
      const before = new LinkResolver(this.paths);
      const linking = this.index.pagesLinking(from);
      await this.vault.move(from, to);
      this.index.renameFile(from, to);
      const after = new LinkResolver(this.paths);

      let rewritten = 0;
      for (const page of linking) {
        const source = page === from ? to : page;
        const text = await this.vault.text(source);
        if (text === null) continue;
        const document = new MarkdownDocument(text);
        if (document.rewriteLinksToRenamed(from, to, source, before, after).rewritten === 0) continue;
        const updated = document.serialized();
        await this.vault.writeText(updated, source);
        this.index.upsertPage(source, updated);
        rewritten++;
      }
      this.onChange?.(new Map([[from, to]]));
      return rewritten;
    });
  }

  /** Deletes a file. Waits for a running pass. */
  delete(path: string): Promise<void> {
    return this.exclusively(async () => {
      await this.vault.delete(path);
      this.index.removeFile(path);
      this.onChange?.(new Map());
    });
  }

  // ── Sync ────────────────────────────────────────────────────────────────────

  /**
   * One sync pass, then the edits held back during it. Resolves to null if a pass was already
   * running or waiting (its result will include this call's changes, or the next pass's will).
   */
  sync(): Promise<SyncReport | null> {
    if (this.isSyncing) return Promise.resolve(null);
    this.isSyncing = true;
    return this.exclusively(async () => {
      let report = emptySyncReport();
      try {
        report = await this.engine.sync();
      } finally {
        await this.finishPass(report);
        this.isSyncing = false;
      }
      this.lastSync = new Date();
      return report;
    }).then((report) => {
      if (report && !isQuiet(report)) this.saveIndexCache().catch(() => {});
      return report;
    });
  }

  private async finishPass(report: SyncReport): Promise<void> {
    const moved = new Map<string, string>();
    for (const { from, to } of report.moved) {
      this.index.renameFile(from, to);
      moved.set(from, to);
    }
    for (const path of [...report.removed, ...report.deletedRemotely]) this.index.removeFile(path);
    const changed = new Set([...report.updated, ...report.merged, ...report.restored, ...report.conflicts.flatMap((c) => [c.path, c.copy])]);
    for (const path of changed) {
      if (this.vault.record(path) === null) continue;
      // An edit held back during the pass wins: index what will be written.
      this.reindexWith(path, this.pending.get(path) ?? (VaultIndex.isPage(path) ? await this.vault.content(path) : null));
    }
    this.conflicts.push(...report.conflicts);

    // Held-back edits follow any move the pass made.
    for (const [path, data] of [...this.pending]) {
      const target = moved.get(path);
      if (target === undefined) continue;
      this.pending.delete(path);
      this.pending.set(target, data);
      this.reindexWith(target, data);
    }
    if (moved.size || changed.size || report.removed.length || report.deletedRemotely.length) this.onChange?.(moved);
  }

  /** Whether anything is waiting to be synced. */
  get hasUnsyncedChanges(): boolean {
    return this.pending.size > 0 || this.vault.records.some((r) => r.dirty || r.deleted || r.fileID === null || r.path !== r.basePath);
  }

  // ── Running one operation at a time ─────────────────────────────────────────

  /**
   * Runs `body` after every operation before it, holding writes back while it runs; writes
   * them when it ends.
   */
  private exclusively<T>(body: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      this.busy = true;
      try {
        return await body();
      } finally {
        await this.flushPending();
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }

  /** Writes held-back edits, then lets writes through again: no await between the last check and that. */
  private async flushPending(): Promise<void> {
    try {
      while (this.pending.size) {
        const held = [...this.pending];
        this.pending.clear();
        for (const [path, data] of held) await this.vault.write(data, path);
      }
    } finally {
      this.busy = false;
    }
  }

  // ── Index ───────────────────────────────────────────────────────────────────

  /** Indexes `path` with its content: a page's text, or nothing for an attachment. */
  private reindexWith(path: string, data: Uint8Array | null): void {
    if (VaultIndex.isPage(path)) {
      if (data !== null) this.index.upsertPage(path, decode(data));
    } else {
      this.index.addFile(path);
    }
  }
}

function join(folder: string, name: string): string {
  return folder === '' ? name : folder + '/' + name;
}

function decode(data: Uint8Array): string {
  // A BOM stays, as in AtlasKit.
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(data);
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
