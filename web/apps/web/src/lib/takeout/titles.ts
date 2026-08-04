/**
 * Titles for imported items.
 *
 * A title backs the name of the Drive file behind a note or a document, so
 * whatever the export called something has to survive being put in a filename:
 * control characters and path separators cannot, and a title long enough to
 * hit the filesystem's limit would fail the whole import rather than one item.
 */

/** Longest title an import will give an item. */
const TITLE_MAX = 200;

export function sanitiseTitle(raw: string): string {
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/[/\\]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > TITLE_MAX ? `${cleaned.slice(0, TITLE_MAX).trimEnd()}…` : cleaned;
}
