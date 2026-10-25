/**
 * A bounded worker pool.
 *
 * Each running upload holds one file in memory while it is encrypted, so the
 * limit is what bounds the tab's memory on a ten-thousand-file import. A worker
 * that rejects does not stop the others (a failed file is reported by the
 * worker itself), and abort means "start nothing new": items already in flight
 * are left to finish, and the pool resolves once they have.
 */

export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const width = Math.max(1, Math.floor(limit) || 1);
  let next = 0;

  async function lane(): Promise<void> {
    while (next < items.length && !signal?.aborted) {
      const index = next++;
      try {
        await worker(items[index], index);
      } catch {
        // The worker's own business to report; the pool carries on.
      }
    }
  }

  const lanes = Array.from({ length: Math.min(width, items.length) }, () => lane());
  await Promise.all(lanes);
}
