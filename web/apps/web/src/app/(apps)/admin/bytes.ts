/**
 * Byte sizes as the admin console reads and writes them.
 *
 * Quotas are stored in bytes and typed in gigabytes, so every size the console
 * shows or accepts passes through here rather than through a conversion written
 * out at each call site — the storage column, the quota editor, the work queue
 * and the user's own request dialog all have to agree on what "10 GB" is.
 */

/** Binary gigabyte — the unit `formatBytes` prints above a gigabyte. */
export const GB = 1024 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(2)} GB`;
}

/**
 * A limit as text, where `null` means unlimited.
 *
 * "Unlimited" and "0 bytes" are opposites, so they must never render the same
 * way; a quota of `null` is the default every account starts on.
 */
export function formatLimit(bytes: number | null): string {
  return bytes === null ? 'Unlimited' : formatBytes(bytes);
}

/**
 * Gigabytes as typed into a form, back to bytes.
 *
 * Empty, or anything that is not a positive number, is `null` — unlimited —
 * because a blank quota field means "no limit", not "no storage". Rounded to a
 * whole byte: the server takes an integer.
 */
export function gigabytesToBytes(value: string): number | null {
  const gb = Number(value.trim());
  if (!value.trim() || !Number.isFinite(gb) || gb <= 0) return null;
  return Math.round(gb * GB);
}

/** Bytes back into the gigabyte figure the form shows. `null` is a blank field. */
export function bytesToGigabytes(bytes: number | null): string {
  if (bytes === null) return '';
  // Trailing zeroes make a round number look like a measurement.
  return String(Number((bytes / GB).toFixed(3)));
}

/**
 * How full a quota is, as a percentage, or `null` where there is no limit to
 * be a percentage of.
 */
export function usagePercent(usedBytes: number, quotaBytes: number | null): number | null {
  if (quotaBytes === null || quotaBytes <= 0) return null;
  return Math.min(100, Math.round((usedBytes / quotaBytes) * 100));
}
