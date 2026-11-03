/**
 * `/atlas`'s model, against an in-memory Drive and local vaults: the steps to an open vault,
 * then what the Mac app's AppModel does with one (editing, links, renames, "link it", sync).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { AtlasModel, type AtlasServices } from '@/app/(apps)/atlas/atlasModel';
import { DRIVE_FILES, MemoryDrive, PNG, browser } from './fakes';

const models: AtlasModel[] = [];
async function ready(services: AtlasServices, vault = 'v1'): Promise<AtlasModel> {
  const model = new AtlasModel('u1', services);
  models.push(model);
  await model.route();
  if (model.phase === 'needsVault') await model.chooseVault(vault);
  await model.syncNow();
  return model;
}

afterEach(async () => {
  await Promise.all(models.splice(0).map((m) => m.dispose()));
});

describe('the steps to an open vault', () => {
  it('asks for the key when this browser has none', async () => {
    const model = new AtlasModel('u1', browser(new MemoryDrive(), { hasKey: false }).services);
    models.push(model);
    await model.route();
    expect(model.phase).toBe('needsKey');
  });

  it('lists Drive folders to choose from, then opens the one chosen and remembers it', async () => {
    const b = browser(new MemoryDrive());
    const model = new AtlasModel('u1', b.services);
    models.push(model);
    await model.route();
    expect(model.phase).toBe('needsVault');
    expect(model.rootFolders.map((f) => f.name)).toEqual(['Atlas', 'Work']);
    await model.chooseVault('v2');
    expect(model.phase).toBe('ready');
    expect(b.services.settings.getItem('neutrino.atlas.vault.u1')).toBe('v2');

    await model.changeVault();
    expect(model.phase).toBe('needsVault');
    expect(b.open.size, 'the copy is closed for another tab').toBe(0);
  });

  it('leaves the vault to a newer model when disposed while starting', async () => {
    const b = browser(new MemoryDrive());
    b.services.settings.setItem('neutrino.atlas.vault.u1', 'v1');
    const first = new AtlasModel('u1', b.services);
    const starting = first.route();
    await first.dispose();
    const second = await ready(b.services);
    await starting;
    expect(second.phase).toBe('ready');
    expect(b.opened, 'only the newer model opened the copy').toEqual(['v1']);
  });

  it('says when another tab has the vault open', async () => {
    const b = browser(new MemoryDrive());
    await ready(b.services);
    const second = new AtlasModel('u1', b.services);
    models.push(second);
    await second.route();
    expect(second.phase).toBe('inUse');
  });
});

describe('an open vault', () => {
  it('saves edits, syncs them, and brings in changes from elsewhere', async () => {
    const drive = new MemoryDrive();
    const here = await ready(browser(drive).services);
    await here.newPage('Plan');
    expect(here.selection).toBe('Plan.md');
    here.edit('# Plan\n');
    here.edit('# Plan\n\nShip it.\n');
    await here.syncNow();
    expect(drive.text('Plan.md')).toBe('# Plan\n\nShip it.\n');

    const there = await ready(browser(drive).services);
    expect(there.pages).toEqual(['Plan.md']);
    expect(there.selection, 'the first sync opens the first page').toBe('Plan.md');
    there.edit('# Plan\n\nShip it. Friday.\n');
    await there.syncNow();

    const version = here.textVersion;
    await here.syncNow();
    expect(here.openText).toBe('# Plan\n\nShip it. Friday.\n');
    expect(here.textVersion, 'the editor is told').toBeGreaterThan(version);
  });

  it('follows links: to a page, to a heading, to no page yet, and to the web', async () => {
    const b = browser(new MemoryDrive());
    const model = await ready(b.services);
    await model.newPage('Goals');
    model.edit('# Goals\n\n## Q4\n');
    await model.newPage('Home');
    model.edit('[[Goals#Q4]] [[New idea]] [site](https://example.com)\n');

    await model.open({ type: 'wiki', ref: { target: 'Goals', heading: 'Q4', blockId: null, alias: null } });
    expect(model.selection).toBe('Goals.md');
    expect(model.anchor).toMatchObject({ heading: 'Q4' });

    await model.open({ type: 'wiki', ref: { target: 'New idea', heading: null, blockId: null, alias: null } });
    expect(model.selection).toBe('New idea.md');

    await model.open({ type: 'url', url: 'https://example.com' });
    expect(b.services.openURL).toHaveBeenCalledWith('https://example.com');
    expect(model.recentPages()).toEqual(['Goals.md', 'Home.md']);
  });

  it('renames a page, rewriting links to it, and keeps it open and starred', async () => {
    const model = await ready(browser(new MemoryDrive()).services);
    await model.newPage('Notes');
    await model.newPage('Plan');
    model.edit('See [[Notes]].\n');
    await model.select('Notes.md');
    model.toggleFavourite('Notes.md');

    await model.rename('Notes.md', 'Meeting notes');
    expect(model.selection).toBe('Meeting notes.md');
    expect(model.favourites.paths).toEqual(['Meeting notes.md']);
    expect(await model.workspace!.text('Plan.md')).toBe('See [[Meeting notes]].\n');
    expect(model.backlinks('Meeting notes.md')).toEqual(['Plan.md']);

    await model.rename('Meeting notes.md', 'Plan');
    expect(model.error).toMatch(/already there/);
  });

  it('links an unlinked mention', async () => {
    const model = await ready(browser(new MemoryDrive()).services);
    await model.newPage('Roadmap');
    await model.newPage('Standup');
    model.edit('We looked at the roadmap.\n');
    await model.flush();
    const [mention] = model.unlinkedMentions('Roadmap.md');
    expect(mention.source).toBe('Standup.md');
    await model.linkMention(mention, 'Roadmap.md');
    expect(model.openText, 'the open page shows it').toBe('We looked at the [[roadmap]].\n');
    expect(model.backlinks('Roadmap.md')).toEqual(['Standup.md']);
  });

  it('remembers favourites, recent pages and the last one open, per vault', async () => {
    const b = browser(new MemoryDrive());
    const first = await ready(b.services);
    await first.newPage('A');
    await first.newPage('B');
    first.toggleFavourite('A.md');
    await first.dispose();

    const again = await ready(b.services);
    expect(again.selection).toBe('B.md');
    expect(again.favourites.paths).toEqual(['A.md']);
    expect(again.recentPages()).toEqual(['A.md']);
  });

  it('moves a page into a folder and back', async () => {
    const model = await ready(browser(new MemoryDrive()).services);
    await model.newPage('Ideas', 'Inbox');
    await model.newPage('Ideas');
    await model.move('Inbox/Ideas.md', '');
    expect(model.error).toMatch(/already in the vault's top level/);
    await model.newFolder('Archive');
    await model.move('Ideas.md', 'Archive');
    expect(model.pages).toEqual(['Archive/Ideas.md', 'Archive/Untitled.md', 'Inbox/Ideas.md']);
  });
});

describe('the editor milestone', () => {
  it('suggests pages while a link is typed, then their headings', async () => {
    const model = await ready(browser(new MemoryDrive()).services);
    await model.newPage('Goals', 'Projects');
    model.edit('# Goals\n\n## Q4 plan\n');
    await model.newPage('Home');
    model.edit('See [[');
    await model.flush();
    expect(model.linkCompletions({ from: 6, to: 6, query: 'goa', page: null })).toEqual([{ title: 'Goals', target: 'Goals', detail: 'Projects' }]);
    expect(model.linkCompletions({ from: 11, to: 11, query: 'q4', page: 'Goals' })).toEqual([{ title: 'Q4 plan', target: 'Q4 plan', detail: 'H2' }]);
    model.edit('# Home\n\n## Notes\n\n[[#');
    expect(model.linkCompletions({ from: 0, to: 0, query: 'no', page: '' }).map((c) => c.title), 'this page, as typed').toEqual(['Notes']);
    expect(model.slashCommands().map((c) => c.id)).toContain('h1');
  });

  it('saves images in the attachments folder and shows them from the vault', async () => {
    const model = await ready(browser(new MemoryDrive()).services);
    await model.newPage('Trip');
    expect(await model.importImages([{ data: PNG, name: 'Beach.png' }, { data: PNG, name: null }])).toEqual([
      'Beach.png',
      expect.stringMatching(/^Pasted image \d{14}\.png$/),
    ]);
    expect(model.workspace!.paths).toContain('Attachments/Beach.png');
    model.attachmentsFolder = 'Media/';
    expect(await model.importImages([{ data: PNG, name: 'Beach.png' }]), 'the shortest link that reaches it').toEqual(['Media/Beach.png']);

    const source = { type: 'embed' as const, ref: { target: 'Media/Beach.png', heading: null, blockId: null, alias: null } };
    const version = model.imagesVersion;
    expect(model.imageURL(source), 'read in the background').toBeNull();
    await waitFor(() => model.imagesVersion > version);
    expect(model.imageURL(source)).toMatch(/^blob:/);
    expect(model.imageURL({ type: 'embed', ref: { ...source.ref, target: 'Missing.png' } })).toBeNull();
  });

  it('copies images picked in Drive into the page, and links files as chips or previews', async () => {
    const model = await ready(browser(new MemoryDrive()).services);
    await model.newPage('Trip');
    expect((await model.driveFolder(null, true)).map((i) => i.name), "the vault's own folder is left out; only folders and images").toEqual(['Pictures']);
    expect((await model.driveFolder(null, false)).map((i) => i.name)).toEqual(['Pictures', 'Q4 plan.docx']);

    await model.insertFromDrive([DRIVE_FILES.pics[0]]);
    expect(model.insertion).toMatchObject({ kind: 'images', images: [{ name: 'Beach.png' }] });

    const doc = DRIVE_FILES.u1[2];
    model.insertLinks([doc]);
    expect(model.insertion).toMatchObject({ kind: 'text', text: `[Q4 plan](${window.location.origin}/open/doc/doc1)`, asBlocks: false });
    model.insertLinks([doc], true);
    expect(model.insertion).toMatchObject({ kind: 'text', text: `![Q4 plan](${window.location.origin}/open/doc/doc1)`, asBlocks: true });

    expect(model.linkChip(`${window.location.origin}/open/doc/doc1`)).toBe('doc');
    expect(model.linkChip('https://www.getneutrino.app/open/sheet/s1')).toBe('sheet');
    expect(model.linkChip('https://example.com/open/doc/x'), 'another site').toBeNull();

    const preview = { type: 'url' as const, url: `${window.location.origin}/open/doc/doc1` };
    const version = model.imagesVersion;
    model.imageURL(preview);
    await waitFor(() => model.imagesVersion > version);
    expect(model.imageURL(preview), 'its Drive thumbnail').toMatch(/^blob:/);
  });

  it('moves and renames folders, with everything in them', async () => {
    const model = await ready(browser(new MemoryDrive()).services);
    await model.newPage('Plan', 'Work/2026');
    await model.newPage('Home');
    model.edit('[[Work/2026/Plan]]\n');
    await model.renameFolder('Work', 'Jobs');
    expect(model.pages).toEqual(['Home.md', 'Jobs/2026/Plan.md']);
    await model.moveFolder('Jobs/2026', '');
    expect(model.pages).toEqual(['2026/Plan.md', 'Home.md']);
    expect(model.backlinks('2026/Plan.md')).toEqual(['Home.md']);
    await model.newPage('Inner', '2026/Sub');
    await model.moveFolder('2026', '2026/Sub');
    expect(model.error).toMatch(/inside itself/);
  });
});
