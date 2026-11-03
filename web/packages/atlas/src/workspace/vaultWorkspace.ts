import { MarkdownDocument } from '../document';
import { decodeIndexCache, encodeIndexCache, type CachedPage, type IndexCacheStore } from '../indexing/indexCache';
import { VaultIndex } from '../indexing/vaultIndex';
import { LinkResolver } from '../resolve';
import { linkingMentions } from '../syntax/mentionLinker';
import { compare, type Vault } from '../sync/vault';
import { VaultSync, emptySyncReport, isQuiet, type SyncReport, type VaultRemote } from '../sync/vaultSync';

/** A folder can't be moved inside itself. */
export class FolderIntoItselfError extends Error {
  constructor(readonly folder: string) {
    super(`“${folder}” can't go inside itself`);
    this.name = 'FolderIntoItselfError';
  }
}

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

  /**
   * "Link it": `source`'s unlinked mentions of `path` become wiki links to it, the words kept
   * (`linkingMentions`). `name` is the title or alias that appears, the page's title by
   * default. Returns how many were linked: none when they couldn't be without changing
   * anything else on the page.
   */
  async linkMentions(path: string, source: string, name: string = VaultIndex.title(path)): Promise<number> {
    const text = await this.text(source);
    if (text === null) return 0;
    const resolver = new LinkResolver(this.paths);
    let target = resolver.linkTarget(path);
    // The shortest target resolves from the vault's root; make sure it does from `source` too.
    if (resolver.resolve(target, source) !== path) target = VaultIndex.isPage(path) ? path.slice(0, -3) : path;
    const linked = linkingMentions(name, target, text);
    if (!linked) return 0;
    await this.writeText(linked.text, source);
    return linked.linked;
  }

  /**
   * Moves every file in folder `from` (pages and attachments, at any depth) to folder `to`,
   * rewriting the links to each as a rename does. `to` may be a rename (`Work` → `Archive`) or a
   * move (`Work` → `Archive/Work`). Nothing moves if any file would land on one that's already
   * there (`FileExistsError`), or if `to` is inside `from` (`FolderIntoItselfError`). Returns how
   * many pages had links rewritten.
   */
  async moveFolder(from: string, to: string): Promise<number> {
    const old = trimmedFolder(from);
    const next = trimmedFolder(to);
    if (old === '' || old === next) return 0;
    if ((next + '/').startsWith(old + '/')) throw new FolderIntoItselfError(old);
    const moves = this.paths.filter((p) => p.startsWith(old + '/')).map((p) => [p, join(next, p.slice(old.length + 1))] as const);
    const taken = moves.find(([, target]) => this.contains(target));
    if (taken) throw new FileExistsError(taken[1]);
    let rewritten = 0;
    for (const [a, b] of moves) rewritten += await this.move(a, b);
    return rewritten;
  }

  /**
   * Saves `data` as a file named `name` in `folder`, numbered if the name is taken
   * (`photo 2.png`), and returns its path. Like any write, sync encrypts and uploads it.
   */
  async addAttachment(data: Uint8Array, name: string, folder: string): Promise<string> {
    // Not hidden: a leading `.` would keep it out of an export and an Obsidian vault.
    const clean = name.replaceAll('/', '-').trim().replace(/^\.+/, '');
    const dot = clean.lastIndexOf('.');
    const ext = dot > 0 ? clean.slice(dot + 1) : '';
    const base = (dot > 0 ? clean.slice(0, dot) : clean) || 'Attachment';
    const named = (stem: string) => join(trimmedFolder(folder), ext === '' ? stem : `${stem}.${ext}`);
    let path = named(base);
    for (let n = 2; this.contains(path); n++) path = named(`${base} ${n}`);
    await this.write(data, path);
    return path;
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

/** The name for an image pasted without one, as Obsidian names them: `Pasted image 20261102111900.png`. */
export function pastedImageName(ext: string, date: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
  return `Pasted image ${stamp}.${ext}`;
}

/** A folder path without slashes or spaces at its ends; "" is the vault's root. */
export function trimmedFolder(folder: string): string {
  return folder.replace(/^[/ ]+|[/ ]+$/g, '');
}

/** Where a folder dropped on `folder` goes: the same name, in that folder. */
export function folderMovedInto(moving: string, folder: string): string {
  const name = trimmedFolder(moving).split('/').pop() ?? '';
  return join(trimmedFolder(folder), name);
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
