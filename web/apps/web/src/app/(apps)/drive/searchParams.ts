/**
 * The Drive search view is addressed by URL (`/drive?q=budget`) so a search can
 * be linked, reloaded, and dismissed with plain navigation.
 */

export const DRIVE_SEARCH_PARAM = 'q';

export function driveSearchHref(query: string): string {
  return `/drive?${DRIVE_SEARCH_PARAM}=${encodeURIComponent(query.trim())}`;
}
