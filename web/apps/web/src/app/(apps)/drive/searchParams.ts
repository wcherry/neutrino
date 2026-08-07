/**
 * The Drive search view is addressed by URL (`/drive?q=budget`) so a search can
 * be linked, reloaded, and dismissed with plain navigation.
 */

export const DRIVE_SEARCH_PARAM = 'q';

/**
 * Opens the listing with one file's preview already up (`/drive?preview=<file id>`).
 *
 * Exists for `/open/file/<id>` Universal Links: a file with no editor of its own has nowhere else
 * to land, and dropping the recipient on an unfiltered listing would lose the file the link named.
 */
export const DRIVE_PREVIEW_PARAM = 'preview';

export function driveSearchHref(query: string): string {
  return `/drive?${DRIVE_SEARCH_PARAM}=${encodeURIComponent(query.trim())}`;
}
