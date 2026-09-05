/**
 * What runs inside the page, before any application code does.
 *
 * `installInPageInstrumentation` is serialised by `page.addInitScript`, so it
 * has to be self-contained: no imports, no closure over anything in this
 * module, and every type it names erased at compile time. It is installed once
 * per context and re-runs on every navigation, which is what makes a
 * per-iteration `page.goto` a clean slate — a fresh document gets a fresh
 * `window.__perf`.
 *
 * It runs *before* the app, deliberately. `PerformanceObserver` with
 * `buffered: true` recovers entries dispatched before the observer existed for
 * most types, but not for `long-animation-frame`, and `web-vitals` cannot
 * report an LCP candidate it was not registered in time to see. Installing
 * late is the difference between measuring the load and measuring the tail of
 * it.
 *
 * The `web-vitals` attribution IIFE is added as a separate init script ahead of
 * this one (see `perf.ts`), so `window.webVitals` is already defined by the
 * time this runs.
 */

import type { InPageMetrics } from './types';

/** How the page-side buffer is reached from Node. */
declare global {
  interface Window {
    __perf?: InPageMetrics;
    __perfReset?: () => void;
    /** Guard against the init script running twice in one document. */
    __perfInstalled?: boolean;
    webVitals?: {
      onLCP: (cb: (m: unknown) => void, opts?: unknown) => void;
      onCLS: (cb: (m: unknown) => void, opts?: unknown) => void;
      onINP: (cb: (m: unknown) => void, opts?: unknown) => void;
      onFCP: (cb: (m: unknown) => void, opts?: unknown) => void;
      onTTFB: (cb: (m: unknown) => void, opts?: unknown) => void;
    };
  }
}

/**
 * Only `performance.measure` names under this prefix are collected.
 *
 * The product marks added in phase 5 all use it (`neutrino:doc:decrypt` and
 * friends). Without the filter the buffer fills with Next's own `beforeRender`
 * / `afterHydrate` measures and every third-party library that marks, and the
 * phase table stops being readable.
 */
export const PHASE_PREFIX = 'neutrino:';

/**
 * The lowest `durationThreshold` the Event Timing spec allows, in milliseconds.
 *
 * Also the value the suite reports as INP when a scenario interacted and no
 * interaction crossed it — meaning "at most this", never "exactly this".
 */
export const EVENT_REPORTING_FLOOR_MS = 16;

/**
 * Arguments, as one object, because `addInitScript` takes exactly one.
 *
 * They are arguments and not module constants for a reason worth stating: the
 * function below is serialised and evaluated in the page, so a reference to
 * anything in this module's scope is a `ReferenceError` *inside the browser* —
 * which aborts the rest of the installer silently. That is how `web-vitals`
 * came to be registered after the observers and then not registered at all:
 * the throw landed between them, the long-task numbers kept arriving, and
 * every LCP went missing with nothing to say why.
 */
export interface InstrumentOptions {
  phasePrefix: string;
  eventThresholdMs: number;
}

export function installInPageInstrumentation(options: InstrumentOptions): void {
  const { phasePrefix, eventThresholdMs } = options;
  if (window.__perfInstalled) return;
  window.__perfInstalled = true;

  const store: InPageMetrics = {
    vitals: [],
    loafs: [],
    longTasks: [],
    events: [],
    marks: [],
    layoutShift: 0,
    navigation: null,
    loafSupported: false,
  };
  window.__perf = store;

  /**
   * Drop everything collected so far.
   *
   * Needed only by scenarios that stay on one document across repeats — an
   * interaction measured five times on the same page would otherwise report
   * the first iteration's long tasks in the fifth. Navigation-based scenarios
   * get a new document, and with it a new `store`, for free.
   */
  window.__perfReset = () => {
    store.vitals.length = 0;
    store.loafs.length = 0;
    store.longTasks.length = 0;
    store.events.length = 0;
    store.marks.length = 0;
    store.layoutShift = 0;
  };

  const observe = (
    type: string,
    cb: (list: PerformanceObserverEntryList) => void,
    extra: Record<string, unknown> = {},
  ): boolean => {
    try {
      new PerformanceObserver(cb).observe({ type, buffered: true, ...extra });
      return true;
    } catch {
      // An unsupported entry type throws rather than no-opping. That is a fact
      // worth recording (see `loafSupported`) but never a reason to fail the
      // scenario — the coarser signals still work.
      return false;
    }
  };

  store.loafSupported = observe('long-animation-frame', (list) => {
    for (const raw of list.getEntries()) {
      const entry = raw as PerformanceEntry & {
        blockingDuration?: number;
        renderStart?: number;
        styleAndLayoutStart?: number;
        scripts?: ReadonlyArray<Record<string, unknown>>;
      };
      store.loafs.push({
        startTime: entry.startTime,
        duration: entry.duration,
        blockingDuration: entry.blockingDuration ?? 0,
        renderStart: entry.renderStart ?? 0,
        styleAndLayoutStart: entry.styleAndLayoutStart ?? 0,
        // Picked apart field by field: a `PerformanceScriptTiming` does not
        // survive `structuredClone`, so returning the entry itself from
        // `page.evaluate` yields `{}`.
        scripts: (entry.scripts ?? []).map((s) => ({
          sourceURL: String(s.sourceURL ?? ''),
          sourceFunctionName: String(s.sourceFunctionName ?? ''),
          sourceCharPosition: Number(s.sourceCharPosition ?? -1),
          duration: Number(s.duration ?? 0),
          invoker: String(s.invoker ?? ''),
          invokerType: String(s.invokerType ?? ''),
          forcedStyleAndLayoutDuration: Number(s.forcedStyleAndLayoutDuration ?? 0),
        })),
      });
    }
  });

  observe('longtask', (list) => {
    for (const entry of list.getEntries()) {
      store.longTasks.push({
        startTime: entry.startTime,
        duration: entry.duration,
        name: entry.name,
      });
    }
  });

  // `durationThreshold: 16`, because the default is **104 ms** — an `event`
  // observer left at the default reports nothing at all for an interaction
  // that took 40 ms, and INP computed from those entries then has no data for
  // exactly the scenarios that are behaving well. 16 ms is the lowest the spec
  // allows; anything faster than that is below the browser's reporting floor
  // and is treated as such by `interactionToNextPaint` in `perf.ts`.
  observe('event', (list) => {
    for (const raw of list.getEntries()) {
      // `interactionId` is what separates one interaction from the several
      // `event` entries it dispatches, and it is missing from the DOM lib in
      // the TypeScript version this repo pins — hence the widened type rather
      // than `PerformanceEventTiming`.
      const entry = raw as PerformanceEventTiming & { interactionId?: number };
      store.events.push({
        name: entry.name,
        startTime: entry.startTime,
        duration: entry.duration,
        processingStart: entry.processingStart,
        processingEnd: entry.processingEnd,
        interactionId: entry.interactionId ?? 0,
      });
    }
  }, { durationThreshold: eventThresholdMs });

  observe('measure', (list) => {
    for (const entry of list.getEntries()) {
      if (!entry.name.startsWith(phasePrefix)) continue;
      store.marks.push({
        name: entry.name,
        startTime: entry.startTime,
        duration: entry.duration,
      });
    }
  });

  observe('layout-shift', (list) => {
    for (const raw of list.getEntries()) {
      const entry = raw as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
      if (entry.hadRecentInput) continue;
      store.layoutShift += entry.value ?? 0;
    }
  });

  observe('navigation', (list) => {
    const entry = list.getEntries()[0] as PerformanceNavigationTiming | undefined;
    if (!entry) return;
    store.navigation = {
      ttfb: entry.responseStart - entry.requestStart,
      domContentLoaded: entry.domContentLoadedEventEnd,
      loadEvent: entry.loadEventEnd,
      domInteractive: entry.domInteractive,
      transferSize: entry.transferSize,
    };
  });

  // ── web-vitals ────────────────────────────────────────────────────────────
  //
  // `reportAllChanges` on every metric, because the defaults report on page
  // hide — which in a Playwright run means "never", since the page is closed
  // rather than backgrounded. The drain in `perf.ts` takes the last report for
  // each metric name, which is the same value the default would have sent.

  const wv = window.webVitals;
  if (!wv) return;

  const push = (raw: unknown): void => {
    const metric = raw as {
      name: InPageMetrics['vitals'][number]['name'];
      value: number;
      rating: InPageMetrics['vitals'][number]['rating'];
      attribution?: Record<string, unknown>;
    };
    store.vitals.push({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      attribution: flatten(metric.attribution),
    });
  };

  /**
   * Reduce an attribution payload to clonable scalars plus the LoAF scripts.
   *
   * The attribution objects hold live `PerformanceEntry` references
   * (`navigationEntry`, `lcpResourceEntry`, `processedEventEntries`,
   * `longAnimationFrameEntries`). Those are exactly what makes the payload
   * unclonable, and all but the LoAF entries are duplicated by the observers
   * above — so scalars are kept, the LoAF scripts are unpacked, and the rest
   * is dropped.
   */
  function flatten(attribution: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!attribution) return {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(attribution)) {
      const kind = typeof value;
      if (kind === 'number' || kind === 'string' || kind === 'boolean') {
        out[key] = value;
      }
    }

    // The one field worth keeping in full: for INP this is the frame that blew
    // the budget, and `longestScript` names the function inside it.
    const longest = attribution.longestScript as
      | { entry?: Record<string, unknown>; subpart?: string; intersectingDuration?: number }
      | undefined;
    if (longest?.entry) {
      out.longestScript = {
        sourceURL: String(longest.entry.sourceURL ?? ''),
        sourceFunctionName: String(longest.entry.sourceFunctionName ?? ''),
        sourceCharPosition: Number(longest.entry.sourceCharPosition ?? -1),
        duration: Number(longest.entry.duration ?? 0),
        invoker: String(longest.entry.invoker ?? ''),
        subpart: String(longest.subpart ?? ''),
        intersectingDuration: Number(longest.intersectingDuration ?? 0),
      };
    }
    return out;
  }

  wv.onLCP(push, { reportAllChanges: true });
  wv.onCLS(push, { reportAllChanges: true });
  wv.onFCP(push, { reportAllChanges: true });
  wv.onTTFB(push, { reportAllChanges: true });
  // `durationThreshold: 0` reports every interaction rather than only those
  // over 40 ms. The scenarios here deliberately measure interactions that
  // should be fast, and the default threshold reports nothing at all for one
  // that already meets its budget — leaving no number to ratchet against.
  wv.onINP(push, { reportAllChanges: true, durationThreshold: 0 });
}
