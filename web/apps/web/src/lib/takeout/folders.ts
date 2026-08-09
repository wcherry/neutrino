/**
 * Resolving import destinations in Drive.
 *
 * An import writes into a folder the user names ("Google Docs"), and a Drive
 * export carries a folder tree of its own that we mirror underneath it. Both
 * come down to the same question — the id of a folder path, creating the
 * folders that aren't there yet — asked once per document, so the answers are
 * cached: a hundred documents in one folder must not be a hundred lookups.
 */

import { filesystemApi, getCurrentUserId } from '@/lib/api';
import { logStep, logWarn } from './log';

/**
 * How many entries to ask for when looking for an existing folder. The listing
 * endpoints default to 200, which a busy Drive root exceeds — and a folder
 * missed because it fell off the end of the page would be created a second
 * time.
 */
const LISTING_LIMIT = 1000;

export interface FolderResolver {
  /**
   * The id of the folder at `path`, creating any missing folder along the way.
   * An empty path is the Drive root, which has no id of its own (`null`).
   */
  folderFor(path: string[]): Promise<string | null>;
}

/** Folder names come from filenames in a zip; Drive cannot store the separators. */
export function sanitiseFolderName(name: string): string {
  return name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/[/\\]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createFolderResolver(): FolderResolver {
  const cache = new Map<string, string | null>();

  async function child(parentId: string | null, name: string): Promise<string> {
    const rootId = parentId ?? getCurrentUserId();
    if (!rootId) throw new Error('Not signed in');
    const contents = await filesystemApi.getFolderContents(rootId, { limit: LISTING_LIMIT });

    const wanted = name.toLowerCase();
    const existing = contents.folders.find((f) => f.name.toLowerCase() === wanted);
    if (existing) {
      logStep('folders', `reusing ${name}`, { id: existing.id, in: parentId ?? '(drive root)' });
      return existing.id;
    }

    // A full page of folders means the one we want may have been beyond it,
    // and we are about to create a duplicate rather than reuse it.
    if (contents.folders.length >= LISTING_LIMIT) {
      logWarn('folders', `listing hit the ${LISTING_LIMIT} limit; an existing "${name}" may have been missed`);
    }

    // `parentId: undefined` rather than `null`: the create endpoint reads a
    // missing key as "at the root".
    const created = await filesystemApi.createFolder(parentId ? { name, parentId } : { name });
    logStep('folders', `created ${name}`, { id: created.id, in: parentId ?? '(drive root)' });
    return created.id;
  }

  async function folderFor(path: string[]): Promise<string | null> {
    const names = path.map(sanitiseFolderName).filter((n) => n.length > 0);
    if (names.length === 0) return null;

    const key = names.join('/').toLowerCase();
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const parentId = await folderFor(names.slice(0, -1));
    const id = await child(parentId, names[names.length - 1]);
    cache.set(key, id);
    return id;
  }

  return { folderFor };
}
