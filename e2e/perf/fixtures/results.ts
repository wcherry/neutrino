/**
 * Accumulating `perf-results.json`.
 *
 * Written after every scenario rather than once at the end, because the runs
 * this file exists for are the long ones: a suite that dies in scenario 40 of
 * 45 should still hand back the 39 measurements it took. `workers: 1` is
 * inherited from the functional config — parallel workers on one machine
 * contaminate every timing — so a single file with no locking is safe.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CPU_THROTTLING, PERF_DIR, RUN_DIR, SCALE_NAME, machineClass } from './env';
import type { RunResults, ScenarioResult } from './types';

export const RESULTS_PATH = path.join(PERF_DIR, 'perf-results.json');

function emptyRun(): RunResults {
  return {
    runId: path.basename(RUN_DIR),
    machineClass: machineClass(),
    startedAt: new Date().toISOString(),
    cpuThrottling: CPU_THROTTLING,
    scale: SCALE_NAME,
    scenarios: [],
  };
}

export function readResults(): RunResults {
  if (!fs.existsSync(RESULTS_PATH)) return emptyRun();
  try {
    return JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8')) as RunResults;
  } catch {
    return emptyRun();
  }
}

/**
 * Append one scenario, replacing any earlier entry with the same id.
 *
 * Replacement matters for `--grep`-ing a single scenario during an
 * investigation: re-running it should update its row rather than leave two
 * disagreeing ones in the same file.
 */
export function recordScenario(result: ScenarioResult): void {
  fs.mkdirSync(PERF_DIR, { recursive: true });
  const run = readResults();
  run.scenarios = run.scenarios.filter((s) => s.id !== result.id);
  run.scenarios.push(result);
  run.scenarios.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  fs.writeFileSync(RESULTS_PATH, `${JSON.stringify(run, null, 2)}\n`);
}

// ── Statistics ──────────────────────────────────────────────────────────────

/**
 * The median, not the mean.
 *
 * One iteration that happened to collide with a background process should not
 * move the reported number, and on five samples that is exactly what a mean
 * does.
 */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

/**
 * Coefficient of variation — standard deviation over the mean.
 *
 * Unitless on purpose: it is compared against one threshold for every metric
 * in the suite, and a millisecond spread means something different for a 4 s
 * page load than for a 40 ms interaction.
 */
export function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance) / Math.abs(mean);
}
