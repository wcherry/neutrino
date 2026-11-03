// AtlasKit's VaultWorkspaceTests, ported (attachments, folder moves and "link it" come with the
// app milestones that use them), and the web's index cache.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeIndexCache, storageIndexCache, type IndexCacheStore } from '../indexing/indexCache';
import { VaultIndex } from '../indexing/vaultIndex';
import { MemoryStorage, Vault } from '../sync/vault';
import type { RemoteFile, VaultRemote } from '../sync/vaultSync';
import { FileExistsError, VaultWorkspace } from '../workspace/vaultWorkspace';
import { FakeDrive } from './fakeDrive';

/** A remote that can hold `replace` until the test lets it go, to land edits in the middle of a pass. */
class GatedDrive implements VaultRemote {
  readonly drive = new FakeDrive();
  holdReplace = false;
  private held: (() => void) | null = null;
  private heldWaiters: (() => void)[] = [];

  /** Resolves once a call is being held. */
  untilHeld(): Promise<void> {
    if (this.held) return Promise.resolve();
    return new Promise((resolve) => this.heldWaiters.push(resolve));
  }

  release(): void {
    this.held?.();
    this.held = null;
    this.holdReplace = false;
  }

  list(): Promise<RemoteFile[]> { return this.drive.list(); }
  download(id: string) { return this.drive.download(id); }
  create(path: string, data: Uint8Array) { return this.drive.create(path, data); }
  async replace(id: string, data: Uint8Array, expectedVersion: number): Promise<number> {
    if (this.holdReplace) {
      await new Promise<void>((resolve) => {
        this.held = resolve;
        this.heldWaiters.forEach((w) => w());
        this.heldWaiters = [];
      });
    }
    return this.drive.replace(id, data, expectedVersion);
  }
  move(id: string, path: string) { return this.drive.move(id, path); }
  delete(id: string) { return this.drive.delete(id); }
}

const workspace = async (remote: VaultRemote, storage = new MemoryStorage(), cache: IndexCacheStore | null = null) =>
  VaultWorkspace.open(await Vault.open(storage), remote, cache);

/** Lets queued promise callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VaultWorkspace', () => {
  it('keeps the index up with every change', async () => {
    const w = await workspace(new FakeDrive());
    const a = await w.createPage('Plan', '', '# Plan\n\nSee [[Notes]] #work\n');
    const b = await w.createPage('Notes', 'Inbox', 'notes\n');
    expect(a).toBe('Plan.md');
    expect(b).toBe('Inbox/Notes.md');
    expect(await w.createPage('Plan')).toBe('Plan 2.md');
    expect(await w.createPage(' a/b ')).toBe('a-b.md');
    expect(w.index.backlinks(b).map((l) => l.source)).toEqual(['Plan.md']);
    expect(w.index.search('notes').map((h) => h.path).sort()).toEqual(['Inbox/Notes.md', 'Plan.md']);

    // A rename rewrites the link to it and keeps the backlink.
    expect(await w.move(b, 'Inbox/Meeting notes.md')).toBe(1);
    expect(await w.text(a)).toBe('# Plan\n\nSee [[Meeting notes]] #work\n');
    expect(w.index.backlinks('Inbox/Meeting notes.md').map((l) => l.source)).toEqual(['Plan.md']);
    await expect(w.move('Plan 2.md', 'Plan.md')).rejects.toBeInstanceOf(FileExistsError);

    await w.delete('Plan 2.md');
    await w.delete('a-b.md');
    expect(w.pages).toEqual(['Inbox/Meeting notes.md', 'Plan.md']);
    expect(w.index.quickSwitch('plan').map((h) => h.path)).toEqual(['Plan.md']);
  });

  it('brings sync results into the index', async () => {
    const drive = new FakeDrive();
    const here = await workspace(drive);
    const there = await workspace(drive);
    await there.writeText('# Elsewhere\n\n#remote\n', 'Elsewhere.md');
    await there.sync();

    const moves: Map<string, string>[] = [];
    here.onChange = (moved) => moves.push(moved);
    await here.sync();
    expect(here.pages).toEqual(['Elsewhere.md']);
    expect(here.index.tags().map((t) => t.tag)).toEqual(['remote']);

    await there.move('Elsewhere.md', 'Moved.md');
    await there.sync();
    await here.sync();
    expect(moves.at(-1)).toEqual(new Map([['Elsewhere.md', 'Moved.md']]));
    expect(here.index.quickSwitch('moved').map((h) => h.path)).toEqual(['Moved.md']);
    expect(here.hasUnsyncedChanges).toBe(false);
  });

  /**
   * The race the workspace exists to prevent: an edit made while the pass pushes the same page
   * would otherwise be committed as synced, and a later pull would overwrite it.
   */
  it('keeps an edit made during a pass and syncs it next', async () => {
    const remote = new GatedDrive();
    const w = await workspace(remote);
    await w.writeText('one\n', 'Page.md');
    await w.sync();
    await w.writeText('two\n', 'Page.md');

    remote.holdReplace = true;
    const pass = w.sync();
    await remote.untilHeld();
    expect(w.isSyncing).toBe(true);
    expect(await w.sync(), 'a pass is already running').toBeNull();
    await w.writeText('three\n', 'Page.md');
    expect(await w.text('Page.md'), 'reads see the held edit').toBe('three\n');
    expect(w.index.search('three').map((h) => h.path)).toEqual(['Page.md']);
    remote.release();
    await pass;

    expect(remote.drive.snapshot).toEqual({ 'Page.md': 'two\n' });
    expect(w.hasUnsyncedChanges, 'the held edit is waiting to be pushed').toBe(true);
    await w.sync();
    expect(remote.drive.snapshot).toEqual({ 'Page.md': 'three\n' });
    expect(w.hasUnsyncedChanges).toBe(false);
  });

  it('waits for the running pass before a move', async () => {
    const remote = new GatedDrive();
    const w = await workspace(remote);
    await w.writeText('a\n', 'A.md');
    await w.sync();
    await w.writeText('b\n', 'A.md');
    remote.holdReplace = true;
    const pass = w.sync();
    await remote.untilHeld();
    const move = w.move('A.md', 'B.md');
    await settle();
    expect(w.pages, "the move hasn't run under the pass").toEqual(['A.md']);
    remote.release();
    await pass;
    await move;
    expect(w.pages).toEqual(['B.md']);
    await w.sync();
    expect(remote.drive.snapshot).toEqual({ 'B.md': 'b\n' });
  });

  it('follows a page held back during a pass that moves it', async () => {
    const drive = new FakeDrive();
    const here = await workspace(drive);
    const there = await workspace(drive);
    await here.writeText('v1\n', 'Old.md');
    await here.sync();
    await there.sync();
    await there.move('Old.md', 'New.md');
    await there.sync();

    // An edit lands while the pass that brings the move is listing.
    const list = drive.list.bind(drive);
    vi.spyOn(drive, 'list').mockImplementationOnce(async () => {
      const listing = await list();
      await here.writeText('v2\n', 'Old.md');
      return listing;
    });
    await here.sync();
    expect(here.pages).toEqual(['New.md']);
    expect(await here.text('New.md')).toBe('v2\n');
    expect(here.index.search('v2').map((h) => h.path)).toEqual(['New.md']);
    await here.sync();
    expect(drive.snapshot).toEqual({ 'New.md': 'v2\n' });
  });
});

describe('the index cache', () => {
  async function cached(storage: MemoryStorage) {
    const cache = storageIndexCache(storage);
    const parses = vi.spyOn(VaultIndex.prototype, 'upsertPage');
    const w = await workspace(new FakeDrive(), storage, cache);
    const parsed = parses.mock.calls.map(([path]) => path).sort();
    parses.mockRestore();
    return { w, parsed, cache };
  }

  it('parses only the pages that changed since it was saved', async () => {
    const storage = new MemoryStorage();
    const first = await cached(storage);
    await first.w.writeText('# A\n\n[[B]] #one\n', 'A.md');
    await first.w.writeText('# B\n\nbee\n', 'B.md');
    await first.w.write(new Uint8Array([1, 2]), 'img.png');
    await first.w.saveIndexCache();

    // Opened again: nothing parsed, and the index is whole.
    const second = await cached(storage);
    expect(second.parsed).toEqual([]);
    expect(second.w.index.backlinks('B.md').map((l) => l.source)).toEqual(['A.md']);
    expect(second.w.index.search('bee').map((h) => h.path)).toEqual(['B.md']);
    expect(second.w.index.tags()).toEqual([{ tag: 'one', count: 1 }]);

    // Edited without saving the cache: only that page is parsed next time, and the cache is updated.
    await second.w.writeText('# B\n\nwasp\n', 'B.md');
    const third = await cached(storage);
    expect(third.parsed).toEqual(['B.md']);
    expect(third.w.index.search('wasp').map((h) => h.path)).toEqual(['B.md']);
    expect(third.w.index.search('bee')).toEqual([]);
    expect((await cached(storage)).parsed).toEqual([]);
  });

  it('is saved after a sync pass brings changes', async () => {
    const drive = new FakeDrive();
    const there = await workspace(drive);
    await there.writeText('remote page\n', 'R.md');
    await there.sync();

    const storage = new MemoryStorage();
    const cache = storageIndexCache(storage);
    const here = await workspace(drive, storage, cache);
    await here.sync();
    await settle();
    expect([...decodeIndexCache(await cache.load()).keys()]).toEqual(['R.md']);
  });

  it('is ignored when unreadable or from another format', async () => {
    const storage = new MemoryStorage();
    const { w, cache } = await cached(storage);
    await w.writeText('text\n', 'P.md');
    await cache.save(new TextEncoder().encode('{"format": 99, "pages": {}}'));
    expect((await cached(storage)).parsed).toEqual(['P.md']);
    await cache.save(new Uint8Array([0xff, 0x00]));
    const again = await cached(storage);
    expect(again.parsed).toEqual(['P.md']);
    expect(again.w.index.search('text').map((h) => h.path)).toEqual(['P.md']);
  });
});
