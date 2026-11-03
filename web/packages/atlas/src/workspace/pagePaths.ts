import { VaultIndex } from '../indexing/vaultIndex';

/** Finder's order: numbers by value, case and accents ignored first. */
const finder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const finderOrder = (a: string, b: string) => finder.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * File types that are attachments rather than pages: `[[photo.png]]` with no such file isn't a
 * page to create. Only these count, so "Meeting 10.30" and "v1.2" are titles.
 */
export const ATTACHMENT_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg', 'bmp', 'tiff', 'pdf',
  'mp3', 'm4a', 'wav', 'ogg', 'flac', 'mp4', 'mov', 'm4v', 'webm',
  'zip', 'csv', 'json', 'txt', 'docx', 'xlsx', 'pptx',
]);

/**
 * Where a wiki link to no page creates one: the folder the link names, else the vault's root,
 * with the link's last part as the title. Null for a link to a non-page file. The Mac app's
 * `PagePaths.pageForUnresolvedLink`.
 */
export function pageForUnresolvedLink(target: string): { folder: string; title: string } | null {
  let name = target.replace(/^[ \t]+|[ \t]+$/g, '');
  if (name.toLowerCase().endsWith('.md')) name = name.slice(0, -3);
  const parts = name.split('/').map((p) => p.replace(/^[ \t]+|[ \t]+$/g, '')).filter((p) => p !== '');
  const title = parts.pop();
  if (title === undefined) return null;
  const dot = title.lastIndexOf('.');
  if (dot > 0 && ATTACHMENT_EXTENSIONS.has(title.slice(dot + 1).toLowerCase())) return null;
  return { folder: parts.join('/'), title };
}

/**
 * The path a page gets when renamed to `title` in the same folder. Null for an empty title, or
 * one with a `/` (a title isn't a path).
 */
export function renamedPath(path: string, title: string): string | null {
  const clean = title.trim();
  if (clean === '' || clean.includes('/')) return null;
  const slash = path.lastIndexOf('/');
  return slash < 0 ? clean + '.md' : path.slice(0, slash) + '/' + clean + '.md';
}

/** The folder a path is in; "" at the vault's root. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** `path` moved into `folder` ("" is the vault's root), keeping its name. */
export function movedInto(path: string, folder: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return folder === '' ? name : folder + '/' + name;
}

/** A node of the sidebar's tree: a folder (with `children`, its id ending in `/`) or a page (its path). */
export interface PageNode {
  id: string;
  name: string;
  children: PageNode[] | null;
}

/** The vault's pages as a tree, folders first, each level in Finder's order. */
export function pageTree(paths: readonly string[]): PageNode[] {
  interface Folder { folders: Map<string, Folder>; pages: string[] }
  const root: Folder = { folders: new Map(), pages: [] };
  for (const path of paths) {
    if (!VaultIndex.isPage(path)) continue;
    let folder = root;
    for (const part of path.split('/').slice(0, -1)) {
      if (part === '') continue;
      let next = folder.folders.get(part);
      if (!next) folder.folders.set(part, (next = { folders: new Map(), pages: [] }));
      folder = next;
    }
    folder.pages.push(path);
  }
  const nodes = (folder: Folder, prefix: string): PageNode[] => {
    const folders = [...folder.folders.keys()].sort(finderOrder).map((name): PageNode => {
      const id = prefix === '' ? name : prefix + '/' + name;
      return { id: id + '/', name, children: nodes(folder.folders.get(name)!, id) };
    });
    const pages = [...folder.pages]
      .sort((a, b) => finderOrder(VaultIndex.title(a), VaultIndex.title(b)))
      .map((p): PageNode => ({ id: p, name: VaultIndex.title(p), children: null }));
    return [...folders, ...pages];
  };
  return nodes(root, '');
}

/** A node of the tag browser: nested tags (`project/atlas`) under their parents. */
export interface TagNode {
  /** The full tag, as first spelled. */
  id: string;
  name: string;
  /** Pages with exactly this tag: a parent used only through its children has none. */
  count: number;
  children: TagNode[] | null;
}

/** The tag browser's tree. */
export function tagTree(tags: readonly { tag: string; count: number }[]): TagNode[] {
  interface Level { count: number; spelled: string; children: Map<string, Level> }
  const root: Level = { count: 0, spelled: '', children: new Map() };
  for (const { tag, count } of tags) {
    let level = root;
    for (const part of tag.split('/')) {
      const key = part.toLowerCase();
      let child = level.children.get(key);
      if (!child) {
        // Spelled as first seen, under its parent's spelling.
        child = { count: 0, spelled: level === root ? part : level.spelled + '/' + part, children: new Map() };
        level.children.set(key, child);
      }
      level = child;
    }
    level.count += count;
  }
  const nodes = (level: Level): TagNode[] | null => {
    if (level.children.size === 0) return null;
    return [...level.children.keys()].sort(finderOrder).map((key) => {
      const child = level.children.get(key)!;
      return { id: child.spelled, name: child.spelled.split('/').pop() ?? '', count: child.count, children: nodes(child) };
    });
  };
  return nodes(root) ?? [];
}

/**
 * An ordered list of pages, such as favourites or the pages opened last, that follows them
 * when they move and drops them when they're gone. AtlasKit's `PageList`.
 */
export class PageList {
  private items: string[];

  /** `limit` is the most it keeps: opening a page past it drops the oldest. */
  constructor(paths: readonly string[] = [], readonly limit: number | null = null) {
    this.items = [...new Set(paths)];
    this.trim();
  }

  get paths(): readonly string[] {
    return this.items;
  }

  contains(path: string): boolean {
    return this.items.includes(path);
  }

  /** Puts `path` first, as the page opened last. */
  moveToFront(path: string): void {
    this.items = [path, ...this.items.filter((p) => p !== path)];
    this.trim();
  }

  /** Adds `path` at the end, unless it's already there. */
  add(path: string): void {
    if (this.contains(path)) return;
    this.items.push(path);
    this.trim();
  }

  remove(path: string): void {
    this.items = this.items.filter((p) => p !== path);
  }

  /** Adds `path`, or removes it when it's there. */
  toggle(path: string): void {
    if (this.contains(path)) this.remove(path);
    else this.add(path);
  }

  /**
   * After the vault changes: follows pages that moved (`moved` maps old path to new), and drops
   * the pages `exists` says are gone, keeping the order.
   */
  update(moved: ReadonlyMap<string, string>, exists: (path: string) => boolean): void {
    const seen = new Set<string>();
    this.items = this.items.map((p) => moved.get(p) ?? p).filter((p) => exists(p) && !seen.has(p) && (seen.add(p), true));
  }

  private trim(): void {
    if (this.limit !== null && this.items.length > this.limit) this.items.length = this.limit;
  }
}
