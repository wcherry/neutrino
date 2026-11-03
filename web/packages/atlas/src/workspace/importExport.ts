import type { VaultWorkspace } from './vaultWorkspace';

/**
 * A folder of Markdown and attachments: an Obsidian vault picked to import, or a vault to
 * export. AtlasKit's `FolderSnapshot`.
 */
export interface FolderSnapshot {
  /** Paths relative to the folder, with `/`, and each file's bytes. */
  files: { path: string; data: Uint8Array }[];
  /** Files left out because they're larger than `MAX_IMPORT_SIZE`. */
  tooLarge: string[];
}

/**
 * Larger files are left out of an import. Drive takes them, but a vault of pages is no place for
 * a disk image, and a mistaken folder choice shouldn't upload one.
 */
export const MAX_IMPORT_SIZE = 100 * 1024 * 1024;

/** A file picked with its folder (`<input webkitdirectory>`): its path below the picked folder, and its bytes. */
export interface PickedFile {
  /** `webkitRelativePath`: the picked folder's name, then the path within it. */
  relativePath: string;
  size: number;
  bytes(): Promise<Uint8Array>;
}

/**
 * The files of a picked folder, as `FolderSnapshot.read` reads a folder on the Mac: paths below
 * the folder itself, NFC, sorted. Hidden files and folders are skipped, so Obsidian's
 * `.obsidian` settings and `.trash`, `.git` and `.DS_Store` stay out.
 */
export async function snapshotOf(picked: Iterable<PickedFile>): Promise<FolderSnapshot> {
  const files: FolderSnapshot['files'] = [];
  const tooLarge: string[] = [];
  for (const file of picked) {
    const parts = file.relativePath.split('/').filter(Boolean).slice(1);
    if (parts.length === 0 || parts.some((p) => p.startsWith('.') || p === '..')) continue;
    const path = parts.join('/').normalize('NFC');
    if (file.size > MAX_IMPORT_SIZE) {
      tooLarge.push(path);
      continue;
    }
    files.push({ path, data: await file.bytes() });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, tooLarge: tooLarge.sort() };
}

/** What an import did. */
export interface ImportReport {
  imported: string[];
  /** Already in the vault with the same content. */
  unchanged: string[];
  /** In the vault with other content: the imported file went beside it. Old path to new. */
  renamed: Map<string, string>;
  tooLarge: string[];
  /** Wiki-link targets that resolve to no file after the import, with how many links use them. */
  unresolvedLinks: { target: string; count: number }[];
}

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const join = (folder: string, name: string) => (folder === '' ? name : `${folder}/${name}`);

/**
 * Imports a folder of Markdown and attachments, such as an Obsidian vault, into `folder` of the
 * vault (its root by default). Every file keeps its bytes: Atlas Markdown reads Obsidian's dialect
 * as it is (SPEC §1), and links resolve the way Obsidian resolves them. A file already here with
 * the same content is skipped; one with other content is imported beside it as
 * `Name (imported).md`, so nothing in the vault is overwritten. AtlasKit's `importFiles`.
 */
export async function importFiles(workspace: VaultWorkspace, snapshot: FolderSnapshot, folder = ''): Promise<ImportReport> {
  const report: ImportReport = { imported: [], unchanged: [], renamed: new Map(), tooLarge: [...snapshot.tooLarge], unresolvedLinks: [] };
  // One change notice for the whole import, not one per file.
  const notify = workspace.onChange;
  workspace.onChange = null;
  try {
    for (const { path: relative, data } of snapshot.files) {
      let path = join(folder, relative);
      const existing = await workspace.content(path);
      if (existing !== null) {
        if (equal(existing, data)) {
          report.unchanged.push(path);
          continue;
        }
        const { path: renamed, alreadyThere } = await importedName(workspace, path, data);
        if (alreadyThere) {
          report.unchanged.push(renamed);
          continue;
        }
        report.renamed.set(path, renamed);
        path = renamed;
      }
      await workspace.write(data, path);
      report.imported.push(path);
    }
  } finally {
    workspace.onChange = notify;
    if (report.imported.length) notify?.(new Map());
  }
  report.unresolvedLinks = workspace.index.unresolvedTargets();
  return report;
}

/** The first free `Name (imported N)` beside `path`, or an earlier import's copy that already holds `data`. */
async function importedName(workspace: VaultWorkspace, path: string, data: Uint8Array): Promise<{ path: string; alreadyThere: boolean }> {
  const slash = path.lastIndexOf('/');
  const folder = slash < 0 ? '' : path.slice(0, slash);
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; ; n++) {
    const candidate = join(folder, `${stem}${n === 1 ? ' (imported)' : ` (imported ${n})`}${ext}`);
    if (!workspace.contains(candidate)) return { path: candidate, alreadyThere: false };
    const there = await workspace.content(candidate);
    if (there && equal(there, data)) return { path: candidate, alreadyThere: true };
  }
}

/** Every file in the vault, decrypted: what an export writes. Pages are the files as they are, so the export is the vault, readable by any Markdown editor. */
export async function exportFiles(workspace: VaultWorkspace): Promise<FolderSnapshot> {
  const files: FolderSnapshot['files'] = [];
  for (const path of workspace.paths) {
    const data = await workspace.content(path);
    if (data) files.push({ path, data });
  }
  return { files, tooLarge: [] };
}

// ── Neutrino Notes ────────────────────────────────────────────────────────────

/** A Drive name as a path segment: no `/`, and not hidden. AtlasKit's `NeutrinoNotes.clean`. */
export function cleanDriveName(name: string): string {
  return name.replaceAll('/', '-').trim().replace(/^\.+/, '');
}

/** A note's file name: its title plus `.md`, unless it already ends in `.md`. */
export function notePageName(name: string): string {
  const clean = cleanDriveName(name);
  const title = clean === '' ? 'Untitled note' : clean;
  return title.toLowerCase().endsWith('.md') ? title : `${title}.md`;
}
