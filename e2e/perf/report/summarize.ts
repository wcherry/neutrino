/**
 * `perf-results.json` → a markdown summary, a verdict, and (on request) a new
 * baseline.
 *
 * Run by `scripts/run-perf.sh` after the suite, and safe to run by hand
 * against an old run:
 *
 *     RUN_DIR=/tmp/neutrino-e2e/<run-id> pnpm exec tsx perf/report/summarize.ts
 *
 * The two baseline flags are the ratchet's two halves and are deliberately
 * separate:
 *
 *   --write   Replace the baseline with this run wholesale. Phase 3 of the
 *             plan: the first time a machine class measures anything, and the
 *             only honest way to turn the design doc's seed budgets into real
 *             ones. Also what to use after a change that is *meant* to move
 *             the numbers.
 *   --update  Ratchet only downwards: metrics that beat their baseline by more
 *             than 10% become the new baseline, everything else is left alone.
 *             Safe to run on any green run.
 *
 * Neither happens on its own. A suite that silently rewrote its own baseline
 * would ratchet a slow regression in one 19% step at a time and report green
 * throughout.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CPU_THROTTLING,
  PERF_DIR,
  SCALE_NAME,
  UNSTABLE_CV,
  machineClass,
} from '../fixtures/env';
import {
  fmt,
  loadBaseline,
  metricKey,
  writeBaseline,
  type BaselineEntry,
  type BaselineFile,
} from '../fixtures/budgets';
import { percentile, readResults } from '../fixtures/results';
import type { MetricSummary, RunResults, ScenarioResult } from '../fixtures/types';

const SUMMARY_PATH = path.join(PERF_DIR, 'perf-summary.md');

const SECTIONS: Record<string, string> = {
  A: 'Shell and navigation',
  B: 'Drive and file listings',
  C: 'Docs editor',
  D: 'Sheets',
  E: 'Slides, diagrams, drawing, photos',
  F: 'Cross-cutting',
};

const ICON = { pass: '✅', fail: '❌', unstable: '⚠️', 'no-budget': '➖' } as const;

/** The first non-empty line of a multi-line error — what a summary row fits. */
function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim().length > 0)?.trim() ?? text;
}

function metricRow(m: MetricSummary): string {
  const cells = [
    ICON[m.verdict],
    `\`${m.metric}\``,
    fmt(m.median, m.unit),
    fmt(percentile(m.samples, 75), m.unit),
    m.budget != null ? fmt(m.budget, m.unit) : '—',
    m.baseline != null ? fmt(m.baseline, m.unit) : '—',
    `${(m.cv * 100).toFixed(0)}%`,
    m.note ?? '',
  ];
  return `| ${cells.join(' | ')} |`;
}

/**
 * Which metrics are worth printing.
 *
 * Every scenario records the full auto-collected set, because a metric with no
 * budget today is what next month's baseline is built from — but a table with
 * fifteen rows per scenario is one nobody reads. Anything budgeted, baselined,
 * failing or unstable is always shown; the rest only in the JSON.
 */
function interesting(m: MetricSummary): boolean {
  return (
    m.budget != null ||
    m.baseline != null ||
    m.verdict === 'fail' ||
    m.verdict === 'unstable'
  );
}

function renderScenario(scenario: ScenarioResult): string {
  const lines: string[] = [];
  const shown = scenario.metrics.filter(interesting);
  const rows = shown.length > 0 ? shown : scenario.metrics.slice(0, 6);

  lines.push(`#### ${scenario.id} — ${scenario.title}`);
  if (scenario.error) {
    lines.push('');
    lines.push(`> ❌ **This scenario did not complete:** ${firstLine(scenario.error)}`);
    lines.push('>');
    lines.push('> Anything below was recorded before it stopped.');
  }
  const meta = [
    scenario.fixture ? `fixture **${scenario.fixture}**` : null,
    `${scenario.repeats} ${scenario.repeats === 1 ? 'repeat' : 'repeats'}`,
    `CPU ${scenario.cpuThrottling}×`,
    `network \`${scenario.network}\``,
  ]
    .filter(Boolean)
    .join(' · ');
  lines.push('');
  lines.push(meta);
  lines.push('');
  lines.push('| | Metric | Median | p75 | Budget | Baseline | CV | |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const m of rows) lines.push(metricRow(m));

  if (scenario.phases.length > 0) {
    lines.push('');
    lines.push('Application phases:');
    lines.push('');
    lines.push('| | Phase | Median | p75 | Budget | Baseline | CV | |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const p of scenario.phases) lines.push(metricRow(p));
  }

  if (scenario.attribution.length > 0) {
    lines.push('');
    lines.push('<details><summary>Slowest frames</summary>');
    lines.push('');
    lines.push('| Duration | Function | Source |');
    lines.push('|---|---|---|');
    for (const frame of scenario.attribution) {
      const where = frame.source
        ? `\`${frame.source.file}:${frame.source.line}\``
        : `\`${frame.chunk.split('/').pop()}\` (no source map)`;
      lines.push(
        `| ${frame.duration.toFixed(0)} ms | \`${frame.functionName}\` | ${where} |`,
      );
    }
    lines.push('');
    lines.push('</details>');
  }

  lines.push('');
  return lines.join('\n');
}

function render(run: RunResults): string {
  const all = run.scenarios.flatMap((s) => [...s.metrics, ...s.phases]);
  const failed = all.filter((m) => m.verdict === 'fail');
  const unstable = all.filter((m) => m.verdict === 'unstable');

  const lines: string[] = [];
  lines.push('# Performance run');
  lines.push('');
  lines.push(`- **Run** \`${run.runId}\` · ${run.startedAt}`);
  lines.push(`- **Machine class** \`${run.machineClass}\``);
  lines.push(`- **CPU throttling** ${run.cpuThrottling}× · **fixture scale** \`${run.scale}\``);
  lines.push(`- **Scenarios** ${run.scenarios.length}`);
  lines.push('');

  const broken = run.scenarios.filter((s) => s.error);
  if (broken.length > 0) {
    lines.push(`❌ **${broken.length} scenario(s) did not complete**`);
    lines.push('');
    for (const s of broken) lines.push(`- \`${s.id}\` — ${firstLine(s.error!)}`);
    lines.push('');
  }

  if (broken.length === 0 && failed.length === 0 && unstable.length === 0) {
    lines.push('✅ No metric exceeded its budget or drifted past its baseline.');
  } else {
    if (failed.length > 0) {
      lines.push(`❌ **${failed.length} metric(s) over budget or baseline**`);
      lines.push('');
      for (const scenario of run.scenarios) {
        for (const m of [...scenario.metrics, ...scenario.phases]) {
          if (m.verdict !== 'fail') continue;
          lines.push(`- \`${scenario.id}\` \`${m.metric}\` — ${m.note}`);
        }
      }
      lines.push('');
    }
    if (unstable.length > 0) {
      lines.push(
        `⚠️ **${unstable.length} metric(s) too noisy to judge** — excluded from the ` +
          'verdict. High variance is itself a finding; if one stays here it needs ' +
          'a look, not a wider tolerance.',
      );
      lines.push('');
      for (const scenario of run.scenarios) {
        for (const m of [...scenario.metrics, ...scenario.phases]) {
          if (m.verdict !== 'unstable') continue;
          lines.push(`- \`${scenario.id}\` \`${m.metric}\` — ${m.note}`);
        }
      }
      lines.push('');
    }
  }

  const bySection = new Map<string, ScenarioResult[]>();
  for (const scenario of run.scenarios) {
    const list = bySection.get(scenario.section) ?? [];
    list.push(scenario);
    bySection.set(scenario.section, list);
  }

  for (const [section, scenarios] of [...bySection].sort()) {
    lines.push(`## ${section}. ${SECTIONS[section] ?? 'Other'}`);
    lines.push('');
    for (const scenario of scenarios) lines.push(renderScenario(scenario));
  }

  lines.push('---');
  lines.push('');
  lines.push(
    'Legend: ✅ within budget and baseline · ❌ over one of them · ' +
      '⚠️ too noisy to judge · ➖ measured, nothing to compare against yet.',
  );
  lines.push('');
  return lines.join('\n');
}

// ── Baselines ───────────────────────────────────────────────────────────────

function rebuildBaseline(run: RunResults, mode: 'write' | 'update'): void {
  const existing = loadBaseline(run.machineClass, CPU_THROTTLING, SCALE_NAME);
  const metrics: Record<string, BaselineEntry> = { ...(existing?.metrics ?? {}) };
  const now = new Date().toISOString();
  let changed = 0;

  for (const scenario of run.scenarios) {
    for (const m of [...scenario.metrics, ...scenario.phases]) {
      // A metric whose repeats disagree cannot be a baseline: it would bake
      // this run's worst luck in as the number everything is judged against.
      // Tested against `cv` rather than the `unstable` flag, because that flag
      // is only set on metrics that already had something to compare against —
      // and the whole point of `--write` is the run where nothing does.
      if (m.cv > UNSTABLE_CV || Number.isNaN(m.median)) continue;
      const key = metricKey(scenario.id, m.metric);
      const previous = metrics[key];

      if (mode === 'write') {
        metrics[key] = { median: m.median, tolerance: previous?.tolerance, recordedAt: now };
        changed += 1;
        continue;
      }
      // --update: downwards only.
      if (previous && m.median < previous.median * 0.9) {
        metrics[key] = { median: m.median, tolerance: previous.tolerance, recordedAt: now };
        changed += 1;
      } else if (!previous) {
        metrics[key] = { median: m.median, recordedAt: now };
        changed += 1;
      }
    }
  }

  const file: BaselineFile = {
    machineClass: run.machineClass,
    cpuThrottling: CPU_THROTTLING,
    scale: SCALE_NAME,
    updatedAt: now,
    metrics,
  };
  writeBaseline(file);
  console.log(
    `Baseline ${mode === 'write' ? 'written' : 'ratcheted'}: ` +
      `${changed} metric(s) → baselines/${run.machineClass}.json`,
  );
}

// ── Entry point ─────────────────────────────────────────────────────────────

function main(): void {
  const run = readResults();
  if (run.scenarios.length === 0) {
    console.log('No scenarios in perf-results.json — nothing to summarise.');
    return;
  }

  fs.mkdirSync(PERF_DIR, { recursive: true });
  fs.writeFileSync(SUMMARY_PATH, render(run));

  const all = run.scenarios.flatMap((s) => [...s.metrics, ...s.phases]);
  const failed = all.filter((m) => m.verdict === 'fail').length;
  const unstable = all.filter((m) => m.verdict === 'unstable').length;
  console.log(
    `Summary → ${SUMMARY_PATH}\n` +
      `  ${run.scenarios.length} scenarios · ${all.length} metrics · ` +
      `${failed} over budget · ${unstable} unstable`,
  );

  if (process.argv.includes('--write')) rebuildBaseline(run, 'write');
  else if (process.argv.includes('--update')) rebuildBaseline(run, 'update');

  if (run.machineClass !== machineClass()) {
    console.warn(
      `Note: this run was recorded on "${run.machineClass}" but you are on ` +
        `"${machineClass()}" — baselines are per machine class and were not compared.`,
    );
  }
}

main();
