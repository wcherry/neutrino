/**
 * Long work on the main thread, broken up so the page keeps painting and answering input.
 *
 * Opening a large workbook used to read every cell, evaluate every formula and hand the result to
 * React in one task — seconds without a frame on a slow machine (the perf suite's D2). Code that
 * walks a lot of data asks `slicer.due()` as it goes and `await`s `slicer.yield()` when it is.
 */

/** Gives the browser a turn: `scheduler.yield()` where there is one, a macrotask otherwise. */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise(resolve => setTimeout(resolve, 0));
}

/** Tracks one stretch of work; `due()` once it has run for `budgetMs` since the last yield. */
export function createSlicer(budgetMs = 12): { due(): boolean; yield(): Promise<void> } {
  let start = performance.now();
  return {
    due: () => performance.now() - start >= budgetMs,
    yield: async () => {
      await yieldToMain();
      start = performance.now();
    },
  };
}
