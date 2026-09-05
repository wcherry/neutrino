/**
 * The shapes that cross the page ↔ Node boundary.
 *
 * Kept in their own module with no imports because half of them are built
 * inside the browser by `instrument.ts` — a file Playwright serialises into an
 * init script — and half are read back in Node. A type that pulled in anything
 * at runtime would break the serialisation.
 */

/** One `web-vitals` report. `attribution` is whatever that metric's build gives. */
export interface VitalSample {
  name: 'LCP' | 'CLS' | 'INP' | 'FCP' | 'TTFB';
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  /**
   * The attribution build's payload, flattened to what survives
   * `structuredClone` across the CDP boundary — `PerformanceEntry` objects do
   * not, so `instrument.ts` picks the fields out rather than passing them on.
   */
  attribution: Record<string, unknown>;
}

/** One script inside a long animation frame — the "which line" of the report. */
export interface ScriptSample {
  /** The chunk URL. Hashed in a production export; `sourcemap.ts` resolves it. */
  sourceURL: string;
  sourceFunctionName: string;
  /** Byte offset into the *generated* chunk, which is what the source map keys on. */
  sourceCharPosition: number;
  duration: number;
  invoker: string;
  invokerType: string;
  forcedStyleAndLayoutDuration: number;
}

/** One `long-animation-frame` entry. */
export interface LoafSample {
  startTime: number;
  duration: number;
  blockingDuration: number;
  renderStart: number;
  styleAndLayoutStart: number;
  scripts: ScriptSample[];
}

/** One `longtask` entry — the coarser signal, present in more situations. */
export interface LongTaskSample {
  startTime: number;
  duration: number;
  name: string;
}

/** One `event` timing entry above the browser's reporting threshold. */
export interface EventSample {
  name: string;
  startTime: number;
  duration: number;
  processingStart: number;
  processingEnd: number;
  interactionId: number;
}

/** One `performance.measure` pair from the product code — see §5 of the doc. */
export interface MarkSample {
  name: string;
  startTime: number;
  duration: number;
}

/** Everything the page collected for one iteration. */
export interface InPageMetrics {
  vitals: VitalSample[];
  loafs: LoafSample[];
  longTasks: LongTaskSample[];
  events: EventSample[];
  marks: MarkSample[];
  /** Sum of `layout-shift` values with no recent input — CLS, computed raw. */
  layoutShift: number;
  /** `performance.timing`-era navigation numbers, from the Navigation Timing entry. */
  navigation: NavigationSample | null;
  /** Set by `instrument.ts` when the Long Animation Frame API is unavailable. */
  loafSupported: boolean;
}

export interface NavigationSample {
  ttfb: number;
  domContentLoaded: number;
  loadEvent: number;
  domInteractive: number;
  transferSize: number;
}

/** A resolved LoAF script frame, after source maps are applied. */
export interface ResolvedFrame {
  /** As reported by the browser. */
  chunk: string;
  functionName: string;
  duration: number;
  /** `null` when no source map was reachable for the chunk. */
  source: { file: string; line: number; column: number } | null;
}

/**
 * Which way is better.
 *
 * Almost everything the suite measures is a cost, where lower is better and a
 * budget is a ceiling. Frame rate is the exception: 50 fps is a *floor*, and
 * judging it as a ceiling would pass a scenario that dropped to 10 fps and
 * fail one that got smoother. Rather than invert the metric — recording
 * milliseconds-per-frame so the arithmetic works — the direction is carried
 * explicitly, so the report says "fps" and means it.
 */
export type Direction = 'lower-is-better' | 'higher-is-better';

/** One metric, aggregated across a scenario's repeats. */
export interface MetricSummary {
  metric: string;
  unit: 'ms' | 'bytes' | 'count' | 'ratio' | 'fps';
  direction: Direction;
  samples: number[];
  median: number;
  min: number;
  max: number;
  /** Coefficient of variation. Above `UNSTABLE_CV` the metric is quarantined. */
  cv: number;
  /** True when `cv` exceeded the threshold — reported, but excluded from the verdict. */
  unstable: boolean;
  budget?: number;
  baseline?: number;
  /** `null` when there was nothing to compare against. */
  verdict: 'pass' | 'fail' | 'unstable' | 'no-budget';
  /** Why it failed, in a sentence, for the markdown summary. */
  note?: string;
}

/** One scenario's entry in `perf-results.json`. */
export interface ScenarioResult {
  id: string;
  title: string;
  /** The section of the scenario catalogue this belongs to — "A".."F". */
  section: string;
  fixture: string | null;
  repeats: number;
  cpuThrottling: number;
  network: string;
  metrics: MetricSummary[];
  /** The worst LoAF frames seen across the repeats, source-mapped where possible. */
  attribution: ResolvedFrame[];
  /** Application phase marks, medianed like any other metric but kept together. */
  phases: MetricSummary[];
  startedAt: string;
  durationMs: number;
  /**
   * Why the scenario body threw, or `null`.
   *
   * A scenario that failed still gets a row — with whatever it managed to
   * record — because "D5 stopped working" is itself worth reporting, and
   * because the section around it kept measuring.
   */
  error: string | null;
}

/** The top level of `perf-results.json`. */
export interface RunResults {
  runId: string;
  machineClass: string;
  startedAt: string;
  cpuThrottling: number;
  scale: string;
  scenarios: ScenarioResult[];
}
