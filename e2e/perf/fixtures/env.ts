/**
 * The knobs, and the one place that reads `process.env`.
 *
 * Every value here lands in `perf-results.json` alongside the numbers, because
 * a perf number without its throttle rate, fixture scale and machine class is
 * not comparable to anything — including its own baseline.
 */

import * as os from 'node:os';
import * as path from 'node:path';

export const BASE_URL = 'http://localhost:9880';

export const RUN_DIR = process.env.RUN_DIR ?? '/tmp/neutrino-e2e/default';

/** Where `perf-results.json`, the markdown summary and any traces are written. */
export const PERF_DIR = path.join(RUN_DIR, 'perf');

/**
 * CPU throttling multiplier applied to every scenario.
 *
 * 4× by default for the two reasons in §4 of the design doc: it makes a fast
 * developer machine behave roughly like a mid-range laptop, and it amplifies
 * main-thread cost so a regression clears the noise floor. Comparing a run at
 * one rate against a baseline recorded at another is meaningless, so the rate
 * is part of the baseline key.
 */
export const CPU_THROTTLING = Number(process.env.PERF_CPU_THROTTLE ?? 4);

/** Repeats per scenario, excluding the discarded warm-up. */
export const REPEATS = Number(process.env.PERF_REPEATS ?? 5);

/**
 * Above this coefficient of variation a metric is reported as unstable and
 * left out of the verdict rather than failing the run. §9: high variance is
 * itself a finding, but it is not a regression.
 */
export const UNSTABLE_CV = Number(process.env.PERF_UNSTABLE_CV ?? 0.15);

/** How far over baseline a metric may drift before it fails. */
export const DEFAULT_TOLERANCE = Number(process.env.PERF_TOLERANCE ?? 0.2);

/** A run this much *under* baseline rewrites it — the ratchet's downward half. */
export const IMPROVEMENT_THRESHOLD = 0.1;

/** `PERF_TRACE=1` emits a Chrome trace per scenario; step 4 of the playbook. */
export const TRACE_ENABLED = process.env.PERF_TRACE === '1';

/**
 * Advisory mode. Metrics are measured, compared and reported, but a breach
 * does not fail the test.
 *
 * The default, following §9: a blocking perf check with an unmeasured noise
 * floor gets disabled within a month. `PERF_ENFORCE=1` turns the verdict into
 * an assertion once the variance is understood.
 */
export const ENFORCE = process.env.PERF_ENFORCE === '1';

// ── Fixture scale ───────────────────────────────────────────────────────────

/**
 * How big `L` actually is.
 *
 * The design doc's sizes (5 000 Drive files, 100 k cells, 2 000 photos) are
 * guesses, and seeding them through the API against the test stack's SQLite
 * costs minutes per run. `default` keeps a full suite to a usable wall time
 * while still being large enough for the unvirtualized-grid hypotheses in §8 —
 * the assertions that matter are about *growth*, not absolute size, so they
 * hold at either scale. `PERF_SCALE=full` restores the doc's numbers for a
 * deliberate deep run.
 */
export type Scale = 'S' | 'M' | 'L';

export interface ScaleProfile {
  files: Record<Scale, number>;
  /** Populated cells in a seeded spreadsheet. */
  cells: Record<Scale, number>;
  /** Paragraphs in a seeded document. */
  paragraphs: Record<Scale, number>;
  photos: Record<Scale, number>;
  slides: Record<Scale, number>;
  /** Nodes in a seeded diagram. */
  diagramNodes: Record<Scale, number>;
  /** Elements on a single seeded slide. */
  slideElements: Record<Scale, number>;
}

const PROFILES: Record<string, ScaleProfile> = {
  /**
   * Big enough to exercise every code path, small enough to seed in seconds.
   *
   * `PERF_SCALE=smoke` is for checking that a scenario still *works* — that
   * its selectors resolve and its waits terminate — after a UI change. The
   * numbers it produces are not comparable to anything, which is why the scale
   * name is part of the baseline key: a smoke run can never be mistaken for a
   * measurement or overwrite one.
   */
  smoke: {
    files: { S: 5, M: 15, L: 40 },
    cells: { S: 100, M: 400, L: 1_000 },
    paragraphs: { S: 5, M: 20, L: 60 },
    photos: { S: 3, M: 6, L: 12 },
    slides: { S: 2, M: 4, L: 6 },
    diagramNodes: { S: 4, M: 10, L: 20 },
    slideElements: { S: 3, M: 6, L: 6 },
  },
  default: {
    files: { S: 25, M: 200, L: 1000 },
    cells: { S: 1_000, M: 10_000, L: 50_000 },
    paragraphs: { S: 20, M: 250, L: 1_000 },
    photos: { S: 20, M: 100, L: 500 },
    slides: { S: 3, M: 20, L: 60 },
    diagramNodes: { S: 10, M: 60, L: 200 },
    slideElements: { S: 5, M: 50, L: 50 },
  },
  full: {
    files: { S: 100, M: 1_000, L: 5_000 },
    cells: { S: 1_000, M: 20_000, L: 100_000 },
    paragraphs: { S: 20, M: 500, L: 2_000 },
    photos: { S: 50, M: 200, L: 2_000 },
    slides: { S: 5, M: 30, L: 100 },
    diagramNodes: { S: 10, M: 60, L: 200 },
    slideElements: { S: 5, M: 50, L: 50 },
  },
};

export const SCALE_NAME = process.env.PERF_SCALE ?? 'default';

export const SCALE: ScaleProfile = PROFILES[SCALE_NAME] ?? PROFILES.default;

// ── Network emulation ───────────────────────────────────────────────────────

export interface NetworkProfile {
  name: string;
  offline: false;
  /** bytes/second */
  downloadThroughput: number;
  uploadThroughput: number;
  /** milliseconds */
  latency: number;
}

/**
 * Localhost hides every byte of transfer cost, so a cold-load scenario run
 * unthrottled measures parse and execute only and reports a load time no user
 * will ever see. Interaction scenarios are the opposite case: their cost is
 * pure main thread, and emulating a slow link there only adds variance.
 */
export const NETWORK: Record<string, NetworkProfile | null> = {
  /** Chrome DevTools' "Fast 3G", to the same numbers. */
  fast3g: {
    name: 'fast3g',
    offline: false,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
    latency: 150,
  },
  /** A middling home connection — used where Fast 3G would dominate the result. */
  broadband: {
    name: 'broadband',
    offline: false,
    downloadThroughput: (20 * 1024 * 1024) / 8,
    uploadThroughput: (5 * 1024 * 1024) / 8,
    latency: 20,
  },
  /** Emulation off. The right choice for anything CPU-bound. */
  none: null,
};

export type NetworkName = keyof typeof NETWORK;

// ── Machine class ───────────────────────────────────────────────────────────

/**
 * The baseline key.
 *
 * Perf numbers are not comparable across machine types, so a baseline recorded
 * on one never gates a run on another — a run with no baseline for its class
 * reports its numbers and records them rather than failing. `PERF_MACHINE`
 * overrides it, which is how a CI runner pins a stable name instead of
 * inheriting whatever the host happens to report.
 */
export function machineClass(): string {
  if (process.env.PERF_MACHINE) return process.env.PERF_MACHINE;
  const cpus = os.cpus();
  const model = (cpus[0]?.model ?? 'unknown')
    .replace(/\(R\)|\(TM\)|CPU|@.*$/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return `${os.platform()}-${os.arch()}-${model}-${cpus.length}x`;
}

/** Viewport fixed for every scenario — a resize changes what is rendered. */
export const VIEWPORT = { width: 1440, height: 900 };
