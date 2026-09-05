/**
 * The ratchet.
 *
 * Two kinds of number gate a scenario, and they do different jobs:
 *
 *  - A **budget** is an absolute ceiling written into the spec — "INP ≤ 200 ms".
 *    It encodes what is acceptable regardless of what the app currently does,
 *    and it never moves on its own. Every budget in the specs today is a *seed*
 *    from §5 of the design doc: a common threshold, not a measurement of this
 *    app.
 *  - A **baseline** is what this machine last measured. It is what actually
 *    catches regressions, because it is the only number with the machine's own
 *    noise floor built into it.
 *
 * A metric passes when it is under its budget *and* within tolerance of its
 * baseline. A metric with neither is reported and recorded, not failed — which
 * is how a new scenario behaves on its first run, and how every scenario
 * behaves on a machine class that has no baseline file yet.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_TOLERANCE, IMPROVEMENT_THRESHOLD, UNSTABLE_CV } from './env';
import type { MetricSummary } from './types';

export const BASELINE_DIR = path.resolve(__dirname, '../baselines');

export interface BaselineEntry {
  median: number;
  /** Per-metric override of the run-wide tolerance. */
  tolerance?: number;
  recordedAt: string;
}

export interface BaselineFile {
  machineClass: string;
  /** Baselines are only comparable at the throttle rate that produced them. */
  cpuThrottling: number;
  scale: string;
  updatedAt: string;
  /** Keyed `"<scenario id>/<metric>"`. */
  metrics: Record<string, BaselineEntry>;
}

export function baselinePath(machineClass: string): string {
  return path.join(BASELINE_DIR, `${machineClass}.json`);
}

/**
 * The committed baseline for this machine, or `null`.
 *
 * A baseline recorded at a different CPU throttle rate or fixture scale is
 * discarded rather than used: comparing across either produces a confident
 * verdict about nothing. The run then behaves like a first run — report and
 * record.
 */
export function loadBaseline(
  machineClass: string,
  cpuThrottling: number,
  scale: string,
): BaselineFile | null {
  const file = baselinePath(machineClass);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as BaselineFile;
    if (parsed.cpuThrottling !== cpuThrottling) return null;
    if (parsed.scale !== scale) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeBaseline(file: BaselineFile): void {
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  fs.writeFileSync(
    baselinePath(file.machineClass),
    `${JSON.stringify(file, null, 2)}\n`,
  );
}

export const metricKey = (scenarioId: string, metric: string): string =>
  `${scenarioId}/${metric}`;

/**
 * Decide one metric's verdict, filling `verdict` and `note` in place.
 *
 * Order matters. Instability is checked first because a metric whose repeats
 * disagree by more than `UNSTABLE_CV` cannot support either comparison — §9
 * quarantines it rather than letting it fail the run at random. After that the
 * absolute budget is checked before the baseline, so a scenario that has
 * ratcheted its way past what is acceptable still fails.
 */
export function judge(
  summary: MetricSummary,
  baseline: BaselineEntry | undefined,
  runTolerance = DEFAULT_TOLERANCE,
): MetricSummary {
  summary.baseline = baseline?.median;

  // Only a metric that is actually being judged can be *excluded* from the
  // verdict, so only those are flagged. Otherwise every scenario reports a
  // warning for `ttfb`, whose median against a localhost stack is a couple of
  // milliseconds and whose coefficient of variation is therefore meaningless
  // — a 2 ms spread on a 3 ms number is 60% variance and no information. The
  // `cv` is still recorded for every metric, and `summarize.ts` uses it
  // directly when deciding what may become a baseline.
  const judged = summary.budget != null || baseline != null;
  summary.unstable = judged && summary.cv > UNSTABLE_CV && summary.samples.length > 1;

  if (summary.unstable) {
    summary.verdict = 'unstable';
    summary.note =
      `repeats vary by ${(summary.cv * 100).toFixed(0)}% ` +
      `(> ${(UNSTABLE_CV * 100).toFixed(0)}%) — excluded from the verdict`;
    return summary;
  }

  const higher = summary.direction === 'higher-is-better';

  if (summary.budget != null) {
    const breached = higher
      ? summary.median < summary.budget
      : summary.median > summary.budget;
    if (breached) {
      summary.verdict = 'fail';
      summary.note =
        `${fmt(summary.median, summary.unit)} ${higher ? 'under' : 'over'} the ` +
        `${fmt(summary.budget, summary.unit)} ${higher ? 'floor' : 'budget'}`;
      return summary;
    }
  }

  if (baseline) {
    const tolerance = baseline.tolerance ?? runTolerance;
    const limit = baseline.median * (higher ? 1 - tolerance : 1 + tolerance);
    const drifted = higher ? summary.median < limit : summary.median > limit;
    if (drifted) {
      summary.verdict = 'fail';
      const drift = Math.abs((summary.median / baseline.median - 1) * 100).toFixed(0);
      summary.note =
        `${drift}% ${higher ? 'below' : 'over'} the ` +
        `${fmt(baseline.median, summary.unit)} baseline ` +
        `(tolerance ${(tolerance * 100).toFixed(0)}%)`;
      return summary;
    }
  }

  summary.verdict = baseline || summary.budget != null ? 'pass' : 'no-budget';
  return summary;
}

/** Whether this result beat its baseline by enough to become the new one. */
export function isImprovement(summary: MetricSummary): boolean {
  if (summary.unstable || summary.baseline == null) return false;
  return summary.direction === 'higher-is-better'
    ? summary.median > summary.baseline * (1 + IMPROVEMENT_THRESHOLD)
    : summary.median < summary.baseline * (1 - IMPROVEMENT_THRESHOLD);
}

export function fmt(value: number, unit: MetricSummary['unit']): string {
  switch (unit) {
    case 'ms':
      return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(0)} ms`;
    case 'bytes':
      if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
      if (value >= 1024) return `${(value / 1024).toFixed(1)} kB`;
      return `${value.toFixed(0)} B`;
    case 'ratio':
      return `${(value * 100).toFixed(1)}%`;
    case 'fps':
      return `${value.toFixed(1)} fps`;
    default:
      return value.toFixed(value < 10 ? 1 : 0);
  }
}
