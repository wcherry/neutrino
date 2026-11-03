// AtlasKit's DailyNotesTests and ImportExportTests, ported (the folder reading, which is the
// browser's here, works on picked files), and the date patterns they rest on.
import { describe, expect, it } from 'vitest';
import { pageSyntax } from '../syntax/pageSyntax';
import { MemoryStorage, Vault } from '../sync/vault';
import { formatDate, parseDate } from '../workspace/dates';
import { exportFiles, importFiles, MAX_IMPORT_SIZE, notePageName, snapshotOf, type PickedFile } from '../workspace/importExport';
import {
  BUILT_IN_TEMPLATES,
  DEFAULT_DAILY_NOTES,
  createPageFromTemplate,
  dailyNoteDate,
  dailyNotePath,
  openDailyNote,
  renderTemplate,
  templates,
} from '../workspace/templates';
import { VaultWorkspace } from '../workspace/vaultWorkspace';
import { FakeDrive } from './fakeDrive';

const day = new Date(2026, 9, 30, 9, 5);
const workspace = async (drive = new FakeDrive()) => VaultWorkspace.open(await Vault.open(new MemoryStorage()), drive);

describe('date patterns', () => {
  it('writes the fields daily notes and templates use', () => {
    expect(formatDate(day, 'yyyy-MM-dd')).toBe('2026-10-30');
    expect(formatDate(day, 'EEEE d MMMM yyyy')).toBe('Friday 30 October 2026');
    expect(formatDate(day, "EEE, MMM d 'at' h:mm a")).toBe('Fri, Oct 30 at 9:05 AM');
    expect(formatDate(day, 'yy/M/d HH:mm:ss')).toBe('26/10/30 09:05:00');
    expect(formatDate(day, "'Week of' d MMM, ''yy")).toBe("Week of 30 Oct, '26");
  });

  it('reads them back', () => {
    expect(parseDate('2026-10-30', 'yyyy-MM-dd')).toEqual(new Date(2026, 9, 30));
    expect(parseDate('Friday 30 October 2026', 'EEEE d MMMM yyyy')).toEqual(new Date(2026, 9, 30));
    expect(parseDate('2026-02-30', 'yyyy-MM-dd'), 'no such day').toBeNull();
    expect(parseDate('Notes', 'yyyy-MM-dd')).toBeNull();
  });
});

describe('daily notes and templates', () => {
  it('fills a template', () => {
    const render = (t: string) => renderTemplate(t, 'Standup', day);
    expect(render('# {{title}}\n\n{{date}} {{time}}\n')).toBe('# Standup\n\n2026-10-30 09:05\n');
    expect(render('{{date:EEEE d MMMM yyyy}}')).toBe('Friday 30 October 2026');
    expect(render('{{ title }} {{unknown}} {{date:}} {{open')).toBe('Standup {{unknown}} {{date:}} {{open');
    expect(render('no variables')).toBe('no variables');
  });

  it('names daily notes by their day, and reads the day back', () => {
    expect(dailyNotePath(DEFAULT_DAILY_NOTES, day)).toBe('Daily/2026-10-30.md');
    expect(dailyNoteDate(DEFAULT_DAILY_NOTES, 'Daily/2026-10-30.md')?.getDate()).toBe(30);
    expect(dailyNoteDate(DEFAULT_DAILY_NOTES, 'Daily/Notes.md')).toBeNull();
    expect(dailyNoteDate(DEFAULT_DAILY_NOTES, 'Other/2026-10-30.md')).toBeNull();
    expect(dailyNotePath({ folder: '', format: 'dd/MM/yyyy', template: '' }, day)).toBe('30-10-2026.md');
    expect(dailyNotePath({ ...DEFAULT_DAILY_NOTES, folder: '/Journal/' }, day)).toBe('Journal/2026-10-30.md');
  });

  it('creates the daily note once, from the template', async () => {
    const w = await workspace();
    const settings = { ...DEFAULT_DAILY_NOTES, template: '# {{date:d MMMM}}\n\n' };
    const path = await openDailyNote(w, day, settings);
    expect(path).toBe('Daily/2026-10-30.md');
    expect(await w.text(path)).toBe('# 30 October\n\n');
    await w.writeText('# 30 October\n\nWritten.\n', path);
    expect(await openDailyNote(w, day, settings)).toBe(path);
    expect(await w.text(path), "opening it again doesn't reset it").toBe('# 30 October\n\nWritten.\n');
  });

  it('offers templates from the templates folder and built in', async () => {
    const w = await workspace();
    expect(templates(w).map((t) => t.name), 'the built-ins, in an empty vault').toEqual(['Meeting']);
    await w.writeText('# {{title}}\n\nRead on {{date}}.\n', 'Templates/Book.md');
    await w.writeText('# Our meeting: {{title}}\n', 'Templates/meeting.md');
    await w.writeText('nested', 'Templates/Old/Book.md');
    await w.writeText('not a template', 'Notes/Book.md');
    await w.write(new Uint8Array([1]), 'Templates/cover.png');
    const found = templates(w);
    expect(found, 'pages replace a built-in of the same name; the shallowest wins; attachments aren\'t templates').toEqual([
      { name: 'Book', path: 'Templates/Book.md' },
      { name: 'meeting', path: 'Templates/meeting.md' },
    ]);
    expect(templates(w, 'Nowhere').map((t) => t.name)).toEqual(['Meeting']);

    const first = await createPageFromTemplate(w, found[0], 'Dune', 'Reading', day);
    expect(first).toBe('Reading/Dune.md');
    expect(await w.text(first)).toBe('# Dune\n\nRead on 2026-10-30.\n');
    const second = await createPageFromTemplate(w, found[0], 'Dune', 'Reading', day);
    expect(await w.text(second), '{{title}} is the title the page gets').toBe('# Dune 2\n\nRead on 2026-10-30.\n');

    const meeting = await createPageFromTemplate(w, BUILT_IN_TEMPLATES[0], 'Standup', '', day);
    const text = (await w.text(meeting))!;
    expect(text).toBe('# Standup\n\nFriday 30 October 2026 · Attendees: \n\n## Agenda\n\n- \n\n## Notes\n\n## Action items\n\n- [ ] \n');
    const tasks = pageSyntax(text).blocks.flatMap((b) => b.spans).filter((s) => s.kind.type === 'syntax' && s.kind.role === 'taskMarker');
    expect(tasks, 'the action item is a task').toHaveLength(1);
  });

  it('keeps one page when two devices make the same day before syncing', async () => {
    const drive = new FakeDrive();
    const a = await workspace(drive);
    const b = await workspace(drive);
    await openDailyNote(a, day, DEFAULT_DAILY_NOTES);
    await openDailyNote(b, day, DEFAULT_DAILY_NOTES);
    await a.sync();
    await b.sync();
    await a.sync();
    expect(a.paths).toEqual(['Daily/2026-10-30.md']);
    expect(b.paths).toEqual(['Daily/2026-10-30.md']);
    expect(Object.keys(drive.snapshot)).toHaveLength(1);
  });
});

describe('import and export', () => {
  const file = (relativePath: string, text: string, size?: number): PickedFile => {
    const data = new TextEncoder().encode(text);
    return { relativePath, size: size ?? data.length, bytes: async () => data };
  };
  /** An Obsidian vault, picked with its folder: pages in folders, an attachment, and settings and trash that stay behind. */
  const obsidianVault = () =>
    snapshotOf([
      file('My Vault/Home.md', '# Home\r\n\r\nSee [[Plan]] and ![[diagram.png]] and [[Missing]].\r\n'),
      file('My Vault/Projects/Plan.md', '---\naliases: [Roadmap]\n---\n- [ ] ship #work\n'),
      file('My Vault/attachments/diagram.png', '\u0089PNG'),
      file('My Vault/.obsidian/app.json', '{}'),
      file('My Vault/.trash/Old.md', 'old'),
      file('My Vault/.DS_Store', ''),
    ]);

  it('reads a picked Obsidian vault', async () => {
    const snapshot = await obsidianVault();
    expect(snapshot.files.map((f) => f.path)).toEqual(['Home.md', 'Projects/Plan.md', 'attachments/diagram.png']);
    expect(new TextDecoder().decode(snapshot.files[0].data), 'bytes as they are').toBe('# Home\r\n\r\nSee [[Plan]] and ![[diagram.png]] and [[Missing]].\r\n');
    const big = await snapshotOf([file('Big/Small.md', 'ok'), file('Big/movie.mov', '', MAX_IMPORT_SIZE + 1)]);
    expect(big.files.map((f) => f.path)).toEqual(['Small.md']);
    expect(big.tooLarge).toEqual(['movie.mov']);
  });

  it('keeps bytes, resolves links, and never overwrites', async () => {
    const w = await workspace();
    await w.writeText('mine\n', 'Home.md');
    let changes = 0;
    w.onChange = () => changes++;
    const report = await importFiles(w, await obsidianVault());
    expect(changes, 'one notice for the import').toBe(1);
    expect(report.imported).toEqual(['Home (imported).md', 'Projects/Plan.md', 'attachments/diagram.png']);
    expect(report.renamed).toEqual(new Map([['Home.md', 'Home (imported).md']]));
    expect(await w.text('Home.md')).toBe('mine\n');
    expect(w.index.backlinks('Projects/Plan.md').map((l) => l.source)).toEqual(['Home (imported).md']);
    expect(w.index.backlinks('attachments/diagram.png').map((l) => l.source)).toEqual(['Home (imported).md']);
    expect(w.index.quickSwitch('roadmap')[0]?.path, 'aliases from frontmatter').toBe('Projects/Plan.md');
    expect(report.unresolvedLinks.map((l) => l.target)).toEqual(['Missing']);

    const again = await importFiles(w, await obsidianVault());
    expect(again.imported, 'importing again changes nothing').toEqual([]);
    expect(new Set(again.unchanged)).toEqual(new Set(['Home (imported).md', 'Projects/Plan.md', 'attachments/diagram.png']));
  });

  it('imports into a folder', async () => {
    const w = await workspace();
    const report = await importFiles(w, await obsidianVault(), 'Obsidian');
    expect(report.imported[0]).toBe('Obsidian/Home.md');
    expect(w.index.backlinks('Obsidian/Projects/Plan.md').map((l) => l.source), 'links resolve by name, wherever the vault lands').toEqual(['Obsidian/Home.md']);
  });

  it('exports the vault as files, which import back the same', async () => {
    const w = await workspace();
    await importFiles(w, await obsidianVault());
    const out = await exportFiles(w);
    expect(new TextDecoder().decode(out.files.find((f) => f.path === 'Projects/Plan.md')!.data)).toBe('---\naliases: [Roadmap]\n---\n- [ ] ship #work\n');
    const back = await workspace();
    await importFiles(back, out);
    expect(back.paths).toEqual(w.paths);
    for (const path of w.paths) expect(await back.content(path)).toEqual(await w.content(path));
  });

  it('names notes as pages', () => {
    expect(notePageName('Q4 plan')).toBe('Q4 plan.md');
    expect(notePageName('readme.MD')).toBe('readme.MD');
    expect(notePageName(' a/b ')).toBe('a-b.md');
    expect(notePageName('.hidden')).toBe('hidden.md');
    expect(notePageName('')).toBe('Untitled note.md');
  });
});
