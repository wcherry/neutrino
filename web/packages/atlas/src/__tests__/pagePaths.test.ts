// AtlasKit's PageListTests and the Mac app's PagePathsTests, ported, and "link it" through the workspace.
import { describe, expect, it } from 'vitest';
import { MemoryStorage, Vault } from '../sync/vault';
import { PageList, pageForUnresolvedLink, pageTree, renamedPath, tagTree } from '../workspace/pagePaths';
import { VaultWorkspace } from '../workspace/vaultWorkspace';
import { FakeDrive } from './fakeDrive';

describe('PageList', () => {
  it('puts the page opened last first and keeps the limit', () => {
    const recent = new PageList([], 3);
    for (const page of ['A.md', 'B.md', 'C.md', 'A.md', 'D.md']) recent.moveToFront(page);
    expect(recent.paths).toEqual(['D.md', 'A.md', 'C.md']);
  });

  it('keeps favourites in order and toggles them', () => {
    const favourites = new PageList(['A.md', 'B.md', 'A.md']);
    expect(favourites.paths).toEqual(['A.md', 'B.md']);
    favourites.toggle('C.md');
    favourites.add('A.md');
    expect(favourites.paths).toEqual(['A.md', 'B.md', 'C.md']);
    favourites.toggle('A.md');
    expect(favourites.paths).toEqual(['B.md', 'C.md']);
    expect(favourites.contains('A.md')).toBe(false);
  });

  it('follows moves and drops deleted pages', () => {
    const list = new PageList(['A.md', 'B.md', 'C.md']);
    const pages = new Set(['Folder/A.md', 'C.md']);
    list.update(new Map([['A.md', 'Folder/A.md']]), (p) => pages.has(p));
    expect(list.paths).toEqual(['Folder/A.md', 'C.md']);
    // A page moved onto one already listed is listed once.
    list.update(new Map([['Folder/A.md', 'C.md']]), (p) => p === 'C.md');
    expect(list.paths).toEqual(['C.md']);
  });
});

describe('page paths', () => {
  it('renames in the same folder', () => {
    expect(renamedPath('Projects/Plan.md', 'Q4 plan')).toBe('Projects/Q4 plan.md');
    expect(renamedPath('Plan.md', '  Plan B ')).toBe('Plan B.md');
    expect(renamedPath('Plan.md', ' ')).toBeNull();
    expect(renamedPath('Plan.md', 'a/b')).toBeNull();
  });

  it('lists folders first, in Finder order', () => {
    const tree = pageTree(['b.md', 'Projects/z.md', 'Projects/Sub/x.md', 'a 10.md', 'a 9.md', 'image.png']);
    expect(tree.map((n) => n.name)).toEqual(['Projects', 'a 9', 'a 10', 'b']);
    expect(tree[0].id).toBe('Projects/');
    expect(tree[0].children?.map((n) => n.name)).toEqual(['Sub', 'z']);
    expect(tree[0].children?.[0].children?.map((n) => n.id)).toEqual(['Projects/Sub/x.md']);
  });

  it('creates a page for a wiki link to none where the link says', () => {
    const at = (t: string) => {
      const p = pageForUnresolvedLink(t);
      return p && [p.folder, p.title];
    };
    expect(at('New idea')).toEqual(['', 'New idea']);
    expect(at('Projects/Q4 plan.md')).toEqual(['Projects', 'Q4 plan']);
    expect(at('Meeting 10.30')).toEqual(['', 'Meeting 10.30']);
    expect(at('diagram.png')).toBeNull();
    expect(at(' / ')).toBeNull();
  });

  it('nests tags under their parents', () => {
    const tree = tagTree([
      { tag: 'project', count: 2 }, { tag: 'project/atlas', count: 3 }, { tag: 'Project/Drive', count: 1 },
      { tag: 'area/home', count: 1 }, { tag: 'idea', count: 4 },
    ]);
    expect(tree.map((n) => n.id)).toEqual(['area', 'idea', 'project']);
    expect(tree[0].count, 'only used through area/home').toBe(0);
    expect(tree[2].count).toBe(2);
    expect(tree[2].children?.map((n) => n.id)).toEqual(['project/atlas', 'project/Drive']);
    expect(tree[2].children?.map((n) => n.name)).toEqual(['atlas', 'Drive']);
    expect(tree[1].children).toBeNull();
  });
});

describe('linkMentions', () => {
  it('links a mention with a target that resolves from the mentioning page', async () => {
    const w = await VaultWorkspace.open(await Vault.open(new MemoryStorage()), new FakeDrive());
    await w.writeText('# Plan\n', 'Projects/Plan.md');
    await w.writeText('# Plan\n', 'Archive/Plan.md');
    await w.writeText('We discussed the plan.\n', 'Archive/Notes.md');
    expect(w.index.unlinkedMentions('Projects/Plan.md').map((m) => m.source)).toContain('Archive/Notes.md');
    // `[[Plan]]` would resolve to Archive/Plan.md from Archive/Notes.md, so the path is used.
    expect(await w.linkMentions('Projects/Plan.md', 'Archive/Notes.md')).toBe(1);
    expect(await w.text('Archive/Notes.md')).toBe('We discussed the [[Projects/Plan|plan]].\n');
    expect(w.index.backlinks('Projects/Plan.md').map((l) => l.source)).toEqual(['Archive/Notes.md']);
    expect(await w.linkMentions('Projects/Plan.md', 'Archive/Notes.md'), 'nothing left to link').toBe(0);
  });
});
