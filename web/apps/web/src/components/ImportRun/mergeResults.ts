/**
 * Folding a retry back into the run it came out of.
 *
 * A retry (issue #155) re-runs the files that failed and nothing else, so its
 * summary describes a handful of items out of a run that may have had
 * thousands. Letting it replace what is on screen would turn "4,997 imported ·
 * 3 failed" into "3 imported" — the retry reporting itself as the whole import.
 *
 * So it replaces the rows it actually attempted, keyed by the file path every
 * runner reports as `file`, and the counts move by the difference between what
 * those rows said before and what they say now. `total` stays the number of
 * items the archive offered, since a retry does not add any.
 */

import type { ImportItem, ImportSummary } from '@/lib/takeout';
import type { ProductResult } from './ImportRunProvider';

/** How many of these items are in each state, as a delta to apply to a summary. */
function tally(items: Iterable<ImportItem>) {
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  for (const item of items) {
    if (item.status === 'imported') imported++;
    else if (item.status === 'skipped') skipped++;
    else failed++;
  }
  return { imported, skipped, failed };
}

function mergeSummary(before: ImportSummary, retry: ImportSummary): ImportSummary {
  const fresh = new Map(retry.items.map((item) => [item.file, item]));

  /** The rows as they stood before, and as the retry now reports them. */
  const overwritten: ImportItem[] = [];
  const rewritten: ImportItem[] = [];
  // Kept in the order the first pass reported them, so the list does not
  // reshuffle under the reader every time a row is retried.
  const items = before.items.map((item) => {
    const now = fresh.get(item.file);
    if (!now) return item;
    fresh.delete(item.file);
    overwritten.push(item);
    rewritten.push(now);
    return now;
  });
  // A file the first pass never reported — it cannot happen through the page's
  // own retry, which offers only rows that are already there, but dropping it
  // would be losing a result we have.
  const added = [...fresh.values()];

  const gone = tally(overwritten);
  const now = tally([...rewritten, ...added]);

  return {
    ...before,
    total: before.total + added.length,
    imported: before.imported - gone.imported + now.imported,
    skipped: before.skipped - gone.skipped + now.skipped,
    failed: before.failed - gone.failed + now.failed,
    items: [...items, ...added],
    folderId: retry.folderId ?? before.folderId,
    // Both are sticky. A run the user stopped left items it never attempted,
    // and retrying the ones it did attempt does not change that; a device with
    // no key wrote nothing either time.
    cancelled: before.cancelled || retry.cancelled,
    unencrypted: before.unencrypted || retry.unencrypted,
  };
}

/**
 * The results of a run with a retry's results laid over them, product by
 * product. A product the retry did not touch is passed through as it was.
 */
export function mergeResults(before: ProductResult[], retry: ProductResult[]): ProductResult[] {
  const byProduct = new Map(retry.map((result) => [result.product, result.summary]));
  return before.map((result) => {
    const fresh = byProduct.get(result.product);
    return fresh ? { product: result.product, summary: mergeSummary(result.summary, fresh) } : result;
  });
}
