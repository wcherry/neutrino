import { VaultIndex } from '../indexing/vaultIndex';
import { matchKey } from '../tags';
import { formatDate, parseDate } from './dates';
import { trimmedFolder, type VaultWorkspace } from './vaultWorkspace';

/**
 * Fills a page template's variables, AtlasKit's `PageTemplate.render`:
 * - `{{title}}`: the new page's title;
 * - `{{date}}`: the date as `yyyy-MM-dd`;
 * - `{{time}}`: the time as `HH:mm`;
 * - `{{date:FORMAT}}`: the date in a Unicode date format, such as `{{date:EEEE d MMMM}}`.
 *
 * Anything else between braces is left as written.
 */
export function renderTemplate(template: string, title: string, date: Date): string {
  if (!template.includes('{{')) return template;
  let out = '';
  let rest = template;
  for (;;) {
    const open = rest.indexOf('{{');
    if (open < 0) break;
    out += rest.slice(0, open);
    const close = rest.indexOf('}}', open + 2);
    if (close < 0) {
      rest = rest.slice(open);
      break;
    }
    const name = rest.slice(open + 2, close).replace(/^[ \t]+|[ \t]+$/g, '');
    if (name === 'title') out += title;
    else if (name === 'date') out += formatDate(date, 'yyyy-MM-dd');
    else if (name === 'time') out += formatDate(date, 'HH:mm');
    else if (name.startsWith('date:') && name.length > 5) out += formatDate(date, name.slice(5));
    else out += rest.slice(open, close + 2);
    rest = rest.slice(close + 2);
  }
  return out + rest;
}

/**
 * Where daily notes go and what they start with, AtlasKit's `DailyNotes`. One note per day,
 * named by its date, so every device opens the same page for the same day.
 *
 * Two devices that create the same day's note before syncing produce one file per device at
 * one path. Sync keeps a single page when their content is identical, and a conflicted copy
 * otherwise. So the default template is empty, and a template should avoid what differs between
 * devices, such as `{{time}}`.
 */
export interface DailyNotes {
  /** The folder, relative to the vault; empty for the vault's root. */
  folder: string;
  /** The file name's date format (Unicode), without `.md`. */
  format: string;
  template: string;
}

export const DEFAULT_DAILY_NOTES: DailyNotes = { folder: 'Daily', format: 'yyyy-MM-dd', template: '' };

/** The day's note: `folder/<date>.md`. A `/` the format produces is kept out of the name. */
export function dailyNotePath(settings: DailyNotes, date: Date): string {
  const name = formatDate(date, settings.format).replaceAll('/', '-') + '.md';
  const folder = trimmedFolder(settings.folder);
  return folder === '' ? name : `${folder}/${name}`;
}

/** The day a note is for, if `path` is a daily note. */
export function dailyNoteDate(settings: DailyNotes, path: string): Date | null {
  const folder = trimmedFolder(settings.folder);
  const prefix = folder === '' ? '' : folder + '/';
  if (!path.startsWith(prefix) || !path.endsWith('.md')) return null;
  const name = path.slice(prefix.length, -3);
  if (name.includes('/')) return null;
  const date = parseDate(name, settings.format);
  return date && dailyNotePath(settings, date) === path ? date : null;
}

/** The day's note, created from the template if there isn't one yet. Returns its path. */
export async function openDailyNote(workspace: VaultWorkspace, date: Date, settings: DailyNotes): Promise<string> {
  const path = dailyNotePath(settings, date);
  if (!workspace.contains(path)) await workspace.writeText(renderTemplate(settings.template, VaultIndex.title(path), date), path);
  return path;
}

/** A page template: a page in the vault's templates folder (`path`), or one built in (`text`). AtlasKit's `Template`. */
export type Template = { name: string; path: string; text?: undefined } | { name: string; text: string; path?: undefined };

/** Templates every vault has. A page in the templates folder with the same name replaces one. */
export const BUILT_IN_TEMPLATES: readonly Template[] = [
  {
    name: 'Meeting',
    text: '# {{title}}\n\n{{date:EEEE d MMMM yyyy}} · Attendees: \n\n## Agenda\n\n- \n\n## Notes\n\n## Action items\n\n- [ ] \n',
  },
];

const finder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The templates to offer: the pages in `folder` and its subfolders (named by title; the
 * shallowest wins a clash), then the built-ins they don't replace, all by name.
 */
export function templates(workspace: VaultWorkspace, folder = 'Templates'): Template[] {
  const prefix = trimmedFolder(folder);
  const byName = new Map<string, Template>();
  for (const path of workspace.paths) {
    if (!VaultIndex.isPage(path) || prefix === '' || !path.startsWith(prefix + '/')) continue;
    const name = VaultIndex.title(path);
    const key = matchKey(name);
    const other = byName.get(key)?.path;
    if (other !== undefined && other.split('/').length <= path.split('/').length) continue;
    byName.set(key, { name, path });
  }
  for (const t of BUILT_IN_TEMPLATES) if (!byName.has(matchKey(t.name))) byName.set(matchKey(t.name), t);
  return [...byName.values()].sort((a, b) => finder.compare(a.name, b.name));
}

/** A template's text: the page's, or the built-in's. */
export async function templateText(workspace: VaultWorkspace, template: Template): Promise<string> {
  return template.path !== undefined ? ((await workspace.text(template.path)) ?? '') : template.text;
}

/**
 * A new page titled `title` in `folder`, from `template` with its variables filled in
 * (`{{title}}` is the title the page gets, numbered if it was taken). Returns its path.
 */
export async function createPageFromTemplate(workspace: VaultWorkspace, template: Template, title: string, folder = '', date: Date = new Date()): Promise<string> {
  const text = await templateText(workspace, template);
  const path = workspace.freePagePath(title, folder);
  await workspace.writeText(renderTemplate(text, VaultIndex.title(path), date), path);
  return path;
}
