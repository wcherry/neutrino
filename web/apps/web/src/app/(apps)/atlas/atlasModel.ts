import {
  DriveVaultRemote,
  FileExistsError,
  FolderIntoItselfError,
  LinkResolver,
  LocalVault,
  PageList,
  VaultIndex,
  VaultInUseError,
  VaultWorkspace,
  builtInSlashCommands,
  extract,
  folderMovedInto,
  headingLinkText,
  imageFileExtension,
  imageMimeType,
  movedInto,
  parse,
  pastedImageName,
  trimmedFolder,
  type ImageSource,
  type LinkCompletion,
  type LinkCompletionContext,
  type SlashCommand,
  pageForUnresolvedLink,
  renamedPath,
  type IndexCacheStore,
  type LinkTarget,
  type Mention,
  type SearchHit,
  type SwitcherHit,
  type Vault,
  type VaultRemote,
  type WikiLinkReference,
} from '@neutrino/atlas';
import { kindForMime, markdownLinkTo, neutrinoDestination, type Destination } from './neutrinoLinks';

/**
 * Neutrino Atlas in the browser: the state of `/atlas`, from this device's key to an open vault.
 * The Mac app's `AppModel`, less what the web app already does (signing in, the keyring).
 *
 * Each step needs the one before it: this account's key in this browser, then a vault (a Drive
 * folder), then the vault open. `start()` works out which step the page is at, and every action
 * that changes it ends by calling `route()`. Pages are changed only through `VaultWorkspace`, so
 * the index never falls behind and edits made during a sync pass are kept.
 *
 * Views read the fields directly and re-render on `subscribe` (`useAtlasModel`).
 */

export type Phase =
  /** Checking the key, or opening the vault. */
  | 'starting'
  /** This browser holds no key for the account: nothing can be read or written. */
  | 'needsKey'
  | 'needsVault'
  /** Another tab has this vault open; it owns this browser's copy. */
  | 'inUse'
  | 'ready';

export type SyncState =
  | { kind: 'idle' }
  | { kind: 'syncing' }
  | { kind: 'synced'; at: Date }
  | { kind: 'failed'; message: string };

/** The heading or block on the open page that a followed link points at, for the editor to show. */
export interface EditorAnchor {
  heading: string | null;
  blockId: string | null;
  /** Tells two requests apart, so following the same link again shows the place again. */
  id: number;
}

/** An image to add to a page, from a paste, a drop or a picker: its bytes, and its name when it had one (a pasted screenshot doesn't). */
export interface ImageImport {
  data: Uint8Array;
  name: string | null;
}

/** A folder or a file in a Drive folder. Names are file names, which Drive keeps in plaintext. */
export interface DriveItem {
  id: string;
  name: string;
  isFolder: boolean;
  mimeType: string | null;
}

/**
 * Something for the open page's editor to put at its cursor: images picked from a file or Drive
 * (it saves them through `importImages`), or text such as links to Neutrino files.
 */
export type Insertion =
  | { id: number; kind: 'images'; images: ImageImport[] }
  | { id: number; kind: 'text'; text: string; asBlocks: boolean };

/** A vault's local copy, opened for this tab. */
export interface OpenedVault {
  vault: Vault;
  indexCache: IndexCacheStore | null;
  close(): Promise<void>;
}

/** What the model reaches the outside through, so tests can stand in for the browser and Drive. */
export interface AtlasServices {
  canEncrypt(userId: string): Promise<boolean>;
  openVault(userId: string, vaultID: string): Promise<OpenedVault>;
  /** Forgets this browser's copy of a vault, for one that can't be opened. */
  discardVault(userId: string, vaultID: string): Promise<void>;
  remote(userId: string, vaultID: string): VaultRemote;
  rootFolders(userId: string): Promise<{ id: string; name: string }[]>;
  createVault(name: string): Promise<string>;
  /** Small per-user settings: which vault, favourites, recent pages. File and folder names only. */
  settings: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  openURL(url: string): void;
  /** A folder of the user's Drive, folders first: for picking images and files to link. The root's id is the user's. */
  driveFolder(folderID: string): Promise<DriveItem[]>;
  /** A Drive image's bytes, decrypted in memory. */
  readDriveImage(fileID: string): Promise<Blob>;
  /**
   * A picture of a Drive file for a link shown as a preview: its cover thumbnail, else for an
   * image no bigger than 25 MB the image itself. Null for a file with neither: it shows as a chip.
   */
  filePreview(fileID: string): Promise<Blob | null>;
}

/** The largest image read whole to preview it, when it has no thumbnail. */
const LARGEST_PREVIEW_READ = 25_000_000;
const finder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const browserServices = (): AtlasServices => ({
  canEncrypt: async (userId) => (await import('@neutrino/api-drive')).canEncryptFor(userId),
  openVault: async (userId, vaultID) => {
    const local = await LocalVault.open(userId, vaultID);
    return { vault: local.vault, indexCache: local.indexCache, close: () => local.close() };
  },
  discardVault: (userId, vaultID) => LocalVault.discard(userId, vaultID),
  remote: (userId, vaultID) => new DriveVaultRemote(userId, vaultID),
  rootFolders: (userId) => DriveVaultRemote.rootFolders(userId),
  createVault: (name) => DriveVaultRemote.createVault(name),
  settings: window.localStorage,
  openURL: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
  driveFolder: async (folderID) => {
    const { filesystemApi } = await import('@neutrino/api-drive');
    const contents = await filesystemApi.getFolderContents(folderID);
    const byName = (a: { name: string }, b: { name: string }) => finder.compare(a.name, b.name);
    return [
      ...contents.folders.map((f) => ({ id: f.id, name: f.name, isFolder: true, mimeType: null })).sort(byName),
      ...contents.files.map((f) => ({ id: f.id, name: f.name, isFolder: false, mimeType: f.mimeType ?? null })).sort(byName),
    ];
  },
  readDriveImage: async (fileID) => (await import('@/lib/driveImages')).readDriveImage(fileID),
  filePreview: async (fileID) => {
    const { storageApi } = await import('@neutrino/api-drive');
    const info = await storageApi.getFileInfo(fileID);
    const thumbnail = storageApi.getThumbnailUrl(info.coverThumbnailUrl);
    if (thumbnail) {
      const response = await fetch(thumbnail);
      if (response.ok) return response.blob();
    }
    if (!info.mimeType?.toLowerCase().startsWith('image/') || info.sizeBytes > LARGEST_PREVIEW_READ) return null;
    return (await import('@/lib/driveImages')).readDriveImage(fileID);
  },
});

export class AtlasModel {
  /** How often an open vault syncs on its own. Drive has no change feed, so this is a poll. */
  static readonly syncInterval = 30_000;
  /** How long after the last keystroke an edit is synced. */
  static readonly editSyncDelay = 3_000;
  static readonly recentLimit = 20;

  phase: Phase = 'starting';
  /** Shown to the user, until dismissed. */
  error: string | null = null;
  /** Something to tell the user that isn't an error. */
  notice: string | null = null;
  busy = false;
  rootFolders: { id: string; name: string }[] = [];

  workspace: VaultWorkspace | null = null;
  pages: string[] = [];
  syncState: SyncState = { kind: 'idle' };

  /** The open page. */
  selection: string | null = null;
  /** The open page's text, as the editor shows it. */
  openText = '';
  /** Changes when `openText` changed from outside the editor (sync, "link it"), for it to reload. */
  textVersion = 0;
  anchor: EditorAnchor | null = null;

  favourites = new PageList();
  recent = new PageList([], AtlasModel.recentLimit);

  /** Changes when an image the editor asked for arrives, or the vault's attachments change, for it to look again. */
  imagesVersion = 0;
  /** Images or links picked for the open page, for its editor to put at its cursor. */
  insertion: Insertion | null = null;
  private insertionCount = 0;
  /** Object URLs of images shown, by file path or `url:` file id: memory only. Null marks one that can't be shown. */
  private images = new Map<string, string | null>();
  private loadingImages = new Set<string>();
  private attachments = '';

  private resolver = new LinkResolver([]);
  private opened: OpenedVault | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private syncSoon: ReturnType<typeof setTimeout> | null = null;
  private syncing: Promise<void> | null = null;
  private reportedUnreadable = '';
  private anchorCount = 0;
  /** The latest edit not yet handed to the workspace, and the write in flight. */
  private unsaved: { path: string; text: string } | null = null;
  private saving: Promise<void> | null = null;
  private closed = false;

  private listeners = new Set<() => void>();
  /** Bumped on every change: what `useSyncExternalStore` compares. */
  version = 0;

  constructor(
    readonly userId: string,
    private readonly services: AtlasServices,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private changed(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  // ── Steps ───────────────────────────────────────────────────────────────────

  /** Works out which step the page is at, and moves to it. */
  async route(): Promise<void> {
    if (this.closed) return;
    const canEncrypt = await this.services.canEncrypt(this.userId);
    // Disposed meanwhile: a newer model owns the page, and the vault's lock.
    if (this.closed) return;
    if (!canEncrypt) {
      await this.closeVault();
      this.phase = 'needsKey';
    } else if (this.storedVaultID === null) {
      await this.closeVault();
      this.phase = 'needsVault';
      this.changed();
      await this.loadRootFolders();
      return;
    } else if (this.workspace === null) {
      await this.openVault(this.storedVaultID);
      return;
    }
    this.changed();
  }

  /** Leaves the page: saves what's typed, syncs it if it can, and lets another tab open the vault. */
  async dispose(): Promise<void> {
    this.closed = true;
    await this.flush();
    if (this.workspace?.hasUnsyncedChanges) await this.workspace.sync().catch(() => null);
    await this.closeVault();
    this.listeners.clear();
  }

  private settingKey(name: string): string {
    return `neutrino.atlas.${name}.${this.userId}`;
  }

  get storedVaultID(): string | null {
    return this.services.settings.getItem(this.settingKey('vault'));
  }

  private set storedVaultID(id: string | null) {
    if (id === null) this.services.settings.removeItem(this.settingKey('vault'));
    else this.services.settings.setItem(this.settingKey('vault'), id);
  }

  async loadRootFolders(): Promise<void> {
    this.busy = true;
    this.changed();
    try {
      this.rootFolders = await this.services.rootFolders(this.userId);
    } catch (e) {
      this.error = `Couldn't list your Drive folders: ${message(e)}`;
    } finally {
      this.busy = false;
      this.changed();
    }
  }

  chooseVault(id: string): Promise<void> {
    this.storedVaultID = id;
    return this.route();
  }

  async createVault(name: string): Promise<void> {
    const clean = name.trim();
    if (clean === '') return;
    this.busy = true;
    this.changed();
    try {
      const id = await this.services.createVault(clean);
      this.busy = false;
      await this.chooseVault(id);
    } catch (e) {
      this.error = `Couldn't create the vault: ${message(e)}`;
    } finally {
      this.busy = false;
      this.changed();
    }
  }

  /** Closes the vault and goes back to choosing one. */
  async changeVault(): Promise<void> {
    await this.flush();
    await this.closeVault();
    this.storedVaultID = null;
    await this.route();
  }

  private async openVault(vaultID: string, retried = false): Promise<void> {
    this.phase = 'starting';
    this.changed();
    let opened: OpenedVault;
    try {
      opened = await this.services.openVault(this.userId, vaultID);
    } catch (e) {
      if (e instanceof VaultInUseError) {
        this.phase = 'inUse';
        this.changed();
        return;
      }
      // A copy this browser can't open (its key is gone) is only a cache: start afresh.
      if (!retried) {
        await this.services.discardVault(this.userId, vaultID).catch(() => {});
        this.error = `This browser's copy of the vault couldn't be opened, so it will be downloaded again. (${message(e)})`;
        return this.openVault(vaultID, true);
      }
      this.error = `The vault couldn't be opened: ${message(e)}`;
      this.storedVaultID = null;
      this.phase = 'needsVault';
      this.changed();
      return;
    }
    if (this.closed) {
      await opened.close();
      return;
    }
    const workspace = await VaultWorkspace.open(opened.vault, this.services.remote(this.userId, vaultID), opened.indexCache);
    this.opened = opened;
    this.workspace = workspace;
    workspace.onChange = (moved) => this.workspaceChanged(moved);
    this.pages = workspace.pages;
    this.resolver = new LinkResolver(workspace.paths);
    this.noteAttachments();
    this.loadPageLists();
    this.phase = 'ready';
    const last = this.services.settings.getItem(this.pageListKey('last'));
    await this.select(last !== null && workspace.contains(last) ? last : (workspace.pages[0] ?? null));
    this.startSyncing();
  }

  private async closeVault(): Promise<void> {
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.syncSoon) clearTimeout(this.syncSoon);
    this.syncTimer = this.syncSoon = null;
    const opened = this.opened;
    const workspace = this.workspace;
    this.opened = null;
    this.workspace = null;
    this.pages = [];
    this.selection = null;
    this.openText = '';
    this.anchor = null;
    this.favourites = new PageList();
    this.recent = new PageList([], AtlasModel.recentLimit);
    this.syncState = { kind: 'idle' };
    this.forgetImages();
    this.insertion = null;
    if (workspace) {
      workspace.onChange = null;
      await workspace.saveIndexCache().catch(() => {});
    }
    await opened?.close();
  }

  // ── Sync ────────────────────────────────────────────────────────────────────

  private startSyncing(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = setInterval(() => void this.syncNow(), AtlasModel.syncInterval);
    void this.syncNow();
  }

  /** One sync pass; resolves when it's done. While one runs, waits for that one instead. */
  syncNow(): Promise<void> {
    if (!this.syncing) this.syncing = this.syncPass().finally(() => (this.syncing = null));
    return this.syncing;
  }

  private async syncPass(): Promise<void> {
    const workspace = this.workspace;
    if (!workspace) return;
    await this.flush();
    this.syncState = { kind: 'syncing' };
    this.changed();
    try {
      const report = await workspace.sync();
      if (this.workspace !== workspace) return;
      this.syncState = { kind: 'synced', at: new Date() };
      // Files this browser can't decrypt are left out and tried again each pass; say so once.
      const unreadable = report ? [...report.unreadable].sort().join('\n') : this.reportedUnreadable;
      if (report && unreadable !== this.reportedUnreadable) {
        this.reportedUnreadable = unreadable;
        if (report.unreadable.length) {
          this.error =
            "Some files in the vault can't be decrypted here, so they're left out; everything else synced. " +
            `They were sealed to a key this browser doesn't hold: ${report.unreadable.join(', ')}`;
        }
      }
      if (report?.conflicts.length) {
        this.error = `Some pages changed here and elsewhere at once. Both versions are kept: ${report.conflicts
          .map((c) => VaultIndex.title(c.copy))
          .join(', ')}`;
      }
    } catch (e) {
      if (this.workspace === workspace) this.syncState = { kind: 'failed', message: message(e) };
    }
    this.changed();
  }

  private syncAfterEdit(): void {
    if (this.syncSoon) clearTimeout(this.syncSoon);
    this.syncSoon = setTimeout(() => {
      this.syncSoon = null;
      void this.syncNow();
    }, AtlasModel.editSyncDelay);
  }

  private workspaceChanged(moved: Map<string, string>): void {
    const workspace = this.workspace;
    if (!workspace) return;
    this.pages = workspace.pages;
    this.resolver = new LinkResolver(workspace.paths);
    const open = this.selection;
    if (open !== null && moved.has(open)) this.selection = moved.get(open)!;
    // A page gone opens the first; so does a vault's first sync on a new device.
    if (this.selection !== null ? !workspace.contains(this.selection) : workspace.pages.length > 0) {
      this.selection = null;
      void this.select(workspace.pages[0] ?? null);
    }
    this.favourites.update(moved, (p) => workspace.contains(p));
    this.recent.update(moved, (p) => workspace.contains(p));
    this.savePageLists();
    this.noteAttachments();
    // Content synced from elsewhere reaches the open page, unless an edit to it is still on its way.
    const path = this.selection;
    if (path !== null && this.unsaved === null && !this.saving) {
      void workspace.text(path).then((text) => {
        if (text !== null && this.selection === path && this.unsaved === null && text !== this.openText) {
          this.openText = text;
          this.textVersion++;
          this.changed();
        }
      });
    }
    this.changed();
  }

  // ── Favourites and recent pages ─────────────────────────────────────────────

  /** Kept per vault in this browser, as paths: file names, which Drive already has in plaintext. */
  private pageListKey(name: string): string {
    return `neutrino.atlas.${name}.${this.userId}.${this.storedVaultID ?? ''}`;
  }

  private loadPageLists(): void {
    const read = (name: string): string[] => {
      try {
        const v = JSON.parse(this.services.settings.getItem(this.pageListKey(name)) ?? '[]') as unknown;
        return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : [];
      } catch {
        return [];
      }
    };
    const exists = (p: string) => this.workspace?.contains(p) ?? false;
    this.favourites = new PageList(read('favourites'));
    this.recent = new PageList(read('recent'), AtlasModel.recentLimit);
    this.favourites.update(new Map(), exists);
    this.recent.update(new Map(), exists);
  }

  private savePageLists(): void {
    this.services.settings.setItem(this.pageListKey('favourites'), JSON.stringify(this.favourites.paths));
    this.services.settings.setItem(this.pageListKey('recent'), JSON.stringify(this.recent.paths));
  }

  /** Quick Open's list before anything is typed: the pages opened last, not counting this one. */
  recentPages(): string[] {
    return this.recent.paths.filter((p) => p !== this.selection);
  }

  toggleFavourite(path: string): void {
    this.favourites.toggle(path);
    this.savePageLists();
    this.changed();
  }

  // ── Pages ───────────────────────────────────────────────────────────────────

  /** Opens a page (or none). The edit being typed is saved first. */
  async select(path: string | null, anchor: WikiLinkReference | null = null): Promise<void> {
    await this.flush();
    const workspace = this.workspace;
    this.selection = path;
    this.anchor = anchor && (anchor.heading || anchor.blockId)
      ? { heading: anchor.heading, blockId: anchor.blockId, id: ++this.anchorCount }
      : null;
    if (path !== null && workspace) {
      this.services.settings.setItem(this.pageListKey('last'), path);
      this.recent.moveToFront(path);
      this.savePageLists();
    }
    this.openText = path !== null && workspace ? ((await workspace.text(path)) ?? '') : '';
    this.textVersion++;
    this.changed();
  }

  /** The editor's text changed. Saved in order, the latest text only, however fast it's typed. */
  edit(text: string): void {
    const path = this.selection;
    if (path === null || !this.workspace || text === this.openText) return;
    this.openText = text;
    this.unsaved = { path, text };
    if (!this.saving) this.saving = this.save();
    this.syncAfterEdit();
  }

  private async save(): Promise<void> {
    try {
      while (this.unsaved && this.workspace) {
        const { path, text } = this.unsaved;
        this.unsaved = null;
        try {
          await this.workspace.writeText(text, path);
        } catch (e) {
          this.error = `Couldn't save ${VaultIndex.title(path)}: ${message(e)}`;
          this.changed();
        }
      }
    } finally {
      this.saving = null;
    }
  }

  /** Resolves once every edit typed so far is in the workspace. */
  async flush(): Promise<void> {
    while (this.saving) await this.saving;
  }

  /** A new page at the vault's root (Obsidian's default), or in `folder`, opened. */
  async newPage(title = 'Untitled', folder = ''): Promise<void> {
    const workspace = this.workspace;
    if (!workspace) return;
    try {
      const path = await workspace.createPage(title, folder);
      await this.select(path);
      this.syncAfterEdit();
    } catch (e) {
      this.error = message(e);
      this.changed();
    }
  }

  /** A new folder named `name` in `parent`. The vault holds files, not folders, so it starts with an Untitled page, which opens. */
  newFolder(name: string, parent = ''): Promise<void> {
    const clean = name.trim().replaceAll('/', '-');
    if (clean === '') return Promise.resolve();
    return this.newPage('Untitled', parent === '' ? clean : `${parent}/${clean}`);
  }

  /** Moves a page into `folder` ("" is the vault's root), keeping its name. Links to it are rewritten across the vault. */
  async move(path: string, folder: string): Promise<void> {
    const target = movedInto(path, folder);
    if (target === path || !this.workspace) return;
    await this.flush();
    try {
      await this.workspace.move(path, target);
      this.syncAfterEdit();
    } catch (e) {
      this.error = e instanceof FileExistsError
        ? `Couldn't move “${VaultIndex.title(path)}” there: a page with that name is already in ${folder === '' ? "the vault's top level" : `“${folder}”`}.`
        : message(e);
      this.changed();
    }
  }

  /** Renames a page in its folder; links to it across the vault are rewritten. */
  async rename(path: string, title: string): Promise<void> {
    const target = renamedPath(path, title);
    if (target === null || target === path || !this.workspace) return;
    await this.flush();
    try {
      await this.workspace.move(path, target);
      this.syncAfterEdit();
    } catch (e) {
      this.error = e instanceof FileExistsError ? `Couldn't rename it to “${title.trim()}”: a page with that name is already there.` : message(e);
      this.changed();
    }
  }

  async delete(path: string): Promise<void> {
    if (!this.workspace) return;
    await this.flush();
    try {
      await this.workspace.delete(path);
      this.syncAfterEdit();
    } catch (e) {
      this.error = message(e);
      this.changed();
    }
  }

  quickSwitch(query: string): SwitcherHit[] {
    return this.workspace?.index.quickSwitch(query) ?? [];
  }

  search(query: string): SearchHit[] {
    return this.workspace?.index.search(query) ?? [];
  }

  tags(): { tag: string; count: number }[] {
    return this.workspace?.index.tags() ?? [];
  }

  /** The pages linking to `path`, each once, in order. */
  backlinks(path: string): string[] {
    const sources = this.workspace?.index.backlinks(path).map((l) => l.source) ?? [];
    return [...new Set(sources)].sort();
  }

  unlinkedMentions(path: string): Mention[] {
    return this.workspace?.index.unlinkedMentions(path) ?? [];
  }

  /** "Link it": the mention's page gets wiki links where it names `path`. */
  async linkMention(mention: Mention, path: string): Promise<void> {
    const workspace = this.workspace;
    if (!workspace) return;
    await this.flush();
    try {
      const linked = await workspace.linkMentions(path, mention.source, mention.name);
      if (linked === 0) {
        this.error = `“${mention.name}” in ${VaultIndex.title(mention.source)} couldn't be linked without changing anything else there. Open it to add the link by hand.`;
      }
      this.syncAfterEdit();
    } catch (e) {
      this.error = message(e);
    }
    this.changed();
  }

  /** The wiki link to a page, `[[Page]]` with the shortest target that reaches it, to paste into another page. */
  linkTo(path: string): string {
    return `[[${this.resolver.linkTarget(path)}]]`;
  }

  /**
   * Follows a link the editor reports. A wiki link to no page creates it, as in Obsidian, and one
   * to a heading or block shows it; web and mail links open in a new tab; a Markdown link to a
   * page opens it.
   */
  async open(link: LinkTarget): Promise<void> {
    const from = this.selection ?? '';
    if (link.type === 'wiki') {
      const ref = link.ref;
      if (ref.target === '') {
        // A heading or block on this page.
        this.anchor = { heading: ref.heading, blockId: ref.blockId, id: ++this.anchorCount };
        this.changed();
        return;
      }
      const path = this.resolver.resolve(ref.target, from);
      if (path !== null) {
        if (VaultIndex.isPage(path)) await this.select(path, ref);
      } else {
        const page = pageForUnresolvedLink(ref.target);
        if (page) await this.newPage(page.title, page.folder);
      }
      return;
    }
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(link.url)?.[1]?.toLowerCase();
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') {
      this.services.openURL(link.url);
      return;
    }
    let decoded = link.url;
    try {
      decoded = decodeURIComponent(link.url);
    } catch {
      // Not percent-encoded: resolve it as written.
    }
    const path = this.resolver.resolve(decoded, from);
    if (path !== null && VaultIndex.isPage(path)) await this.select(path);
  }

  /** Opens the page with this title, creating it if there is none (the quick switcher's Return). */
  async openOrCreate(title: string): Promise<void> {
    const trimmed = title.trim();
    if (trimmed === '') return;
    const hit = this.quickSwitch(trimmed).find((h) => VaultIndex.title(h.path).toLowerCase() === trimmed.toLowerCase());
    if (hit) await this.select(hit.path);
    else await this.newPage(trimmed);
  }

  // ── Folders ─────────────────────────────────────────────────────────────────

  /** Moves a folder, with everything in it, into `destination` ("" is the vault's root). */
  moveFolder(folder: string, destination: string): Promise<void> {
    return this.moveFolderTo(folder, folderMovedInto(folder, destination));
  }

  /** Renames a folder in place. */
  renameFolder(folder: string, name: string): Promise<void> {
    const clean = name.trim();
    if (clean === '' || clean.includes('/')) return Promise.resolve();
    const parent = trimmedFolder(folder).split('/').slice(0, -1).join('/');
    return this.moveFolderTo(folder, parent === '' ? clean : `${parent}/${clean}`);
  }

  private async moveFolderTo(folder: string, target: string): Promise<void> {
    if (!this.workspace || trimmedFolder(folder) === trimmedFolder(target)) return;
    await this.flush();
    try {
      await this.workspace.moveFolder(folder, target);
      this.syncAfterEdit();
    } catch (e) {
      this.error = e instanceof FolderIntoItselfError
        ? "A folder can't go inside itself."
        : e instanceof FileExistsError
          ? `Couldn't move “${trimmedFolder(folder)}” to “${target}”: some of its pages would land on pages already there.`
          : message(e);
      this.changed();
    }
  }

  // ── The editor's suggestions ────────────────────────────────────────────────

  /**
   * Suggestions while a wiki link is typed: the quick switcher's matches, each with the shortest
   * link that reaches it, then after `#` the headings of the page it names.
   */
  linkCompletions(context: LinkCompletionContext): LinkCompletion[] {
    const workspace = this.workspace;
    if (!workspace) return [];
    if (context.page !== null) {
      let headings: { depth: number; text: string }[];
      if (context.page === '') {
        // This page, as typed so far: the index catches up only after the edit is saved.
        headings = extract(parse(this.openText)).headings;
      } else {
        const path = this.resolver.resolve(context.page, this.selection ?? '');
        if (path === null || !VaultIndex.isPage(path)) return [];
        headings = workspace.index.headings(path);
      }
      return VaultIndex.matchingHeadings(headings, context.query, 12).map((h) => ({ title: h.text, target: headingLinkText(h.text), detail: `H${h.depth}` }));
    }
    return workspace.index.quickSwitch(context.query, 8).map((hit) => {
      const slash = hit.path.lastIndexOf('/');
      return { title: hit.alias ?? hit.title, target: this.resolver.linkTarget(hit.path), detail: slash < 0 ? null : hit.path.slice(0, slash) };
    });
  }

  /** The editor's `/` menu. Templates join it with the templates milestone. */
  slashCommands(): SlashCommand[] {
    return builtInSlashCommands();
  }

  // ── Images ──────────────────────────────────────────────────────────────────

  /** The vault folder images pasted, dropped or picked are saved in. */
  get attachmentsFolder(): string {
    return this.services.settings.getItem(`neutrino.atlas.attachments.${this.userId}`) ?? 'Attachments';
  }

  set attachmentsFolder(folder: string) {
    this.services.settings.setItem(`neutrino.atlas.attachments.${this.userId}`, trimmedFolder(folder));
    this.changed();
  }

  /**
   * Something to show for an image the open page has: an object URL of its bytes from the
   * vault's encrypted copy (decrypted in memory only), or for a link to a Neutrino file its
   * preview. Null until it's ready (`imagesVersion` changes then), and for an image there's none of.
   */
  imageURL(source: ImageSource): string | null {
    const workspace = this.workspace;
    if (!workspace) return null;
    if (source.type === 'url') {
      const destination = neutrinoDestination(source.url);
      return destination ? this.image(`url:${destination.fileID}`, () => this.services.filePreview(destination.fileID)) : null;
    }
    const written = source.type === 'embed' ? source.ref.target : source.path;
    const path = this.resolver.resolve(written, this.selection ?? '');
    if (path === null || VaultIndex.isPage(path)) return null;
    return this.image(path, async () => {
      const data = await workspace.content(path);
      if (!data) return null;
      const ext = imageFileExtension(data) ?? path.slice(path.lastIndexOf('.') + 1);
      return new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer], { type: imageMimeType(ext) });
    });
  }

  private image(key: string, load: () => Promise<Blob | null>): string | null {
    if (this.images.has(key)) return this.images.get(key)!;
    if (!this.loadingImages.has(key)) {
      this.loadingImages.add(key);
      void load()
        .catch((e) => {
          console.info(`[atlas] ${key} can't be shown: ${message(e)}`);
          return null;
        })
        .then((blob) => {
          this.loadingImages.delete(key);
          if (this.closed) return;
          this.images.set(key, blob ? URL.createObjectURL(blob) : null);
          this.imagesVersion++;
          this.changed();
        });
    }
    return null;
  }

  private forgetImages(): void {
    for (const url of this.images.values()) if (url) URL.revokeObjectURL(url);
    this.images.clear();
    this.imagesVersion++;
  }

  /** The vault's attachments changed: images are read again. */
  private noteAttachments(): void {
    const now = (this.workspace?.paths ?? []).filter((p) => !VaultIndex.isPage(p)).join('\n');
    if (now === this.attachments) return;
    this.attachments = now;
    for (const [key, url] of [...this.images]) {
      if (key.startsWith('url:')) continue;
      if (url) URL.revokeObjectURL(url);
      this.images.delete(key);
    }
    this.imagesVersion++;
  }

  /**
   * Saves images pasted, dropped or picked into the attachments folder, encrypted like every
   * file in the vault and uploaded by the next sync, and returns the link target for each.
   */
  async importImages(images: ImageImport[]): Promise<string[]> {
    const workspace = this.workspace;
    if (!workspace) return [];
    const targets: string[] = [];
    for (const image of images) {
      const name = image.name ?? pastedImageName(imageFileExtension(image.data) ?? 'png');
      try {
        const path = await workspace.addAttachment(image.data, name, this.attachmentsFolder);
        this.resolver = new LinkResolver(workspace.paths);
        targets.push(this.resolver.linkTarget(path));
      } catch (e) {
        this.error = `Couldn't add the image ${name}: ${message(e)}`;
      }
    }
    if (targets.length) this.syncAfterEdit();
    this.changed();
    return targets;
  }

  /** Images picked from files, for the open page's editor to add at its cursor. */
  insertImages(images: ImageImport[]): void {
    if (images.length === 0) return;
    this.insertion = { id: ++this.insertionCount, kind: 'images', images };
    this.changed();
  }

  /** The images picked in Neutrino Drive, read and decrypted in memory, added to the open page: copied into the vault, so the page keeps them whatever happens to the originals. */
  async insertFromDrive(items: DriveItem[]): Promise<void> {
    const images: ImageImport[] = [];
    this.busy = true;
    this.changed();
    for (const item of items) {
      try {
        images.push({ data: new Uint8Array(await (await this.services.readDriveImage(item.id)).arrayBuffer()), name: item.name });
      } catch (e) {
        this.error = `Couldn't read ${item.name} from Neutrino Drive: ${message(e)}`;
      }
    }
    this.busy = false;
    this.insertImages(images);
    this.changed();
  }

  // ── Links to Neutrino files ─────────────────────────────────────────────────

  /** A folder of the user's Drive, for the pickers; the vault's own folder is left out. */
  async driveFolder(folderID: string | null, imagesOnly: boolean): Promise<DriveItem[]> {
    const items = await this.services.driveFolder(folderID ?? this.userId);
    return items.filter((i) => i.id !== this.storedVaultID && (i.isFolder || !imagesOnly || (i.mimeType ?? '').startsWith('image/')));
  }

  /** How a link shows in the editor: a Neutrino link as a chip, with the kind of file it opens. */
  linkChip(url: string): Destination['kind'] | null {
    return neutrinoDestination(url)?.kind ?? null;
  }

  /** Puts links to the files picked in Neutrino Drive at the open page's cursor: as chips in the text, or as previews, each on a line of its own. */
  insertLinks(items: DriveItem[], asPreviews = false): void {
    const links = items.filter((i) => !i.isFolder).map((i) => markdownLinkTo(i));
    if (links.length === 0) return;
    this.insertion = asPreviews
      ? { id: ++this.insertionCount, kind: 'text', text: links.map((l) => '!' + l).join('\n'), asBlocks: true }
      : { id: ++this.insertionCount, kind: 'text', text: links.join(', '), asBlocks: false };
    this.changed();
  }

  /** Whether a file in Drive is one a link can preview as a picture without reading it: an image. */
  static isImage(item: DriveItem): boolean {
    return kindForMime(item.mimeType) === 'file' && (item.mimeType ?? '').startsWith('image/');
  }

  dismissError(): void {
    this.error = null;
    this.changed();
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
