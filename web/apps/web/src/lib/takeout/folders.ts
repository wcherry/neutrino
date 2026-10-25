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
   * The path is relative to the resolver's base folder; an empty path is the
   * base itself, which for the Drive root has no id of its own (`null`).
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

/**
 * A resolver for folder paths under `baseFolderId` (the Drive root when it is
 * absent or `null`). An empty path is the base itself.
 *
 * Answers are cached as **promises**, not ids. The Takeout runners ask one
 * question at a time, but the local folder import uploads several files at once,
 * and two files landing in a folder that does not exist yet would otherwise both
 * miss the cache and both create it. A creation that fails is dropped from the
 * cache, so the next file in that folder tries again rather than inheriting the
 * failure.
 */
export function createFolderResolver(baseFolderId: string | null = null): FolderResolver {
  const cache = new Map<string, Promise<string | null>>();

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

  function resolve(names: string[]): Promise<string | null> {
    if (names.length === 0) return Promise.resolve(baseFolderId);

    const key = names.join('/').toLowerCase();
    const cached = cache.get(key);
    if (cached) return cached;

    const pending = resolve(names.slice(0, -1)).then((parentId) => child(parentId, names[names.length - 1]));
    cache.set(key, pending);
    // Evict a failure so a later file in the same folder can try again. The
    // identity check keeps a retry's own promise if it was cached meanwhile.
    pending.catch(() => {
      if (cache.get(key) === pending) cache.delete(key);
    });
    return pending;
  }

  function folderFor(path: string[]): Promise<string | null> {
    return resolve(path.map(sanitiseFolderName).filter((n) => n.length > 0));
  }

  return { folderFor };
}
