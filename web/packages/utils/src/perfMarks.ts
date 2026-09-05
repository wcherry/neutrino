/**
 * Application phase marks.
 *
 * A slow document open is one number until you know how it was spent. These
 * put `performance.measure` pairs around the phases that matter — fetch,
 * decrypt, parse, recalc, autosave, image resolve — so the performance suite
 * can report "document load 1.2 s, of which decrypt 700 ms" instead of "1.2 s",
 * and so a regression in one of them is self-diagnosing.
 *
 * Every name starts with `neutrino:`, which is the prefix the suite filters on
 * (`e2e/perf/fixtures/instrument.ts`). Without the filter the buffer fills with
 * Next's own `beforeRender`/`afterHydrate` measures and whatever every
 * third-party library marks, and the phase table stops being readable.
 *
 * These are unconditional and permanent, by design. `performance.mark` on a
 * page with nothing observing it is a few microseconds and no allocation; the
 * alternative — inferring phases from a trace — is much weaker attribution for
 * anyone reading a CI artifact rather than reproducing locally. They are also
 * useful outside the suite: they show up in the DevTools performance panel's
 * Timings track for free.
 *
 * Failure is never the caller's problem. The User Timing API is missing in
 * some server-rendering and test environments, and a measurement helper that
 * can break a document open is worse than no measurement.
 */

/** The prefix every phase name carries. Mirrored by the perf suite's filter. */
export const PERF_MARK_PREFIX = 'neutrino:';

function canMeasure(): boolean {
  return (
    typeof performance !== 'undefined' &&
    typeof performance.mark === 'function' &&
    typeof performance.measure === 'function'
  );
}

let counter = 0;

/**
 * Time an async phase.
 *
 * ```ts
 * const model = await measurePhase('doc:parse', () => readDocx(bytes));
 * ```
 *
 * `name` is written without the prefix — `doc:parse`, not
 * `neutrino:doc:parse` — so call sites read as the phase they are.
 *
 * The measure is emitted whether `fn` resolves or rejects: a phase that failed
 * still took time, and a document open that errors halfway is exactly the case
 * where knowing where it got to is worth something.
 */
export async function measurePhase<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!canMeasure()) return fn();

  const full = `${PERF_MARK_PREFIX}${name}`;
  // Unique per call: several images resolving concurrently would otherwise
  // share a start mark, and every one of them would measure from the first.
  const start = `${full}:start:${(counter += 1)}`;
  try {
    performance.mark(start);
  } catch {
    return fn();
  }

  try {
    return await fn();
  } finally {
    try {
      performance.measure(full, start);
    } catch {
      // A cleared buffer between the mark and here. Nothing to report.
    }
    try {
      performance.clearMarks(start);
    } catch {
      /* nothing to clean up */
    }
  }
}

/** The synchronous counterpart, for a phase that does not await. */
export function measurePhaseSync<T>(name: string, fn: () => T): T {
  if (!canMeasure()) return fn();

  const full = `${PERF_MARK_PREFIX}${name}`;
  const start = `${full}:start:${(counter += 1)}`;
  try {
    performance.mark(start);
  } catch {
    return fn();
  }

  try {
    return fn();
  } finally {
    try {
      performance.measure(full, start);
    } catch {
      /* buffer cleared */
    }
    try {
      performance.clearMarks(start);
    } catch {
      /* nothing to clean up */
    }
  }
}
