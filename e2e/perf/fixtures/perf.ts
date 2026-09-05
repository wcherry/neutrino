/**
 * The perf rig: throttle, instrument, repeat, aggregate, judge, record.
 *
 * A perf spec describes one scenario and hands over a body. Everything around
 * that body — CPU and network emulation, injecting `web-vitals`, discarding
 * the warm-up, running the repeats, taking the median, resolving the LoAF
 * frames through source maps, comparing against budget and baseline, writing
 * the result — happens here, once, so a new scenario costs a dozen lines.
 *
 * ## Why the repeats live inside the fixture
 *
 * Playwright's `repeatEach` would run the scenario five times as five separate
 * tests, and there would then be nowhere to compute a median: each test knows
 * only its own number, and the verdict needs all five. Running the repeats
 * inside `perf.scenario` keeps the aggregation, the stability check and the
 * assertion in one place, and lets the spec assert on the median directly.
 *
 * ## Why one page, not one context per repeat
 *
 * The obvious way to get an empty cache per repeat is a fresh browser context.
 * It is also wrong here: the E2EE keyring lives in IndexedDB, which
 * `storageState` does not carry, so a fresh context means signing in and
 * minting a key again — five times per scenario, none of it measured but all
 * of it slow, and each key different from the last. Instead the session is set
 * up once and each repeat clears the HTTP cache through CDP, which is the
 * thing a cold-load scenario actually cares about.
 */

import { expect, type APIRequestContext, type CDPSession, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test as base } from '../../fixtures/base';
import {
  BASE_URL,
  CPU_THROTTLING,
  DEFAULT_TOLERANCE,
  ENFORCE,
  NETWORK,
  PERF_DIR,
  REPEATS,
  SCALE_NAME,
  TRACE_ENABLED,
  machineClass,
  type NetworkName,
} from './env';
import {
  EVENT_REPORTING_FLOOR_MS,
  installInPageInstrumentation,
  PHASE_PREFIX,
} from './instrument';
import { isImprovement, judge, loadBaseline, metricKey } from './budgets';
import { coefficientOfVariation, median, percentile, recordScenario } from './results';
import { resolveWorstFrames } from './sourcemap';
import type {
  InPageMetrics,
  LoafSample,
  MetricSummary,
  ResolvedFrame,
  ScenarioResult,
} from './types';

/**
 * The `web-vitals` attribution build, as a plain script to inject.
 *
 * It has to be the IIFE: `addInitScript` evaluates a classic script in the
 * page, so an ESM build would throw on its first `import` and a UMD one would
 * find no module loader. The package's `exports` map does not name the IIFE,
 * so it cannot be `require.resolve`d directly — resolving the entry it *does*
 * export locates `dist/` without hard-coding a path through `node_modules`,
 * which under pnpm is a symlink farm rather than a directory.
 */
const WEB_VITALS_IIFE = path.join(
  path.dirname(require.resolve('web-vitals/attribution')),
  'web-vitals.attribution.iife.js',
);
if (!fs.existsSync(WEB_VITALS_IIFE)) {
  throw new Error(
    `web-vitals attribution IIFE not found at ${WEB_VITALS_IIFE} — ` +
      'a version bump has moved or dropped it, and without it there is no ' +
      'LCP/INP attribution to report.',
  );
}

/**
 * …with the global put back.
 *
 * The IIFE ends in `var webVitals = …`, which is a global only when the script
 * is evaluated at the top level of a document. Playwright's init scripts are
 * evaluated inside a function wrapper, so the `var` is scoped to that wrapper
 * and `window.webVitals` never exists — the instrumentation then installs the
 * observers, finds no `webVitals`, and reports every long task with no LCP or
 * INP beside it. Appending the assignment is the whole fix.
 */
const WEB_VITALS_SOURCE = `${fs.readFileSync(WEB_VITALS_IIFE, 'utf8')}\n;window.webVitals = webVitals;`;

export type Unit = MetricSummary['unit'];

/** One recorded number, before aggregation. */
interface Reading {
  name: string;
  value: number;
  unit: Unit;
  /** Phase marks are summarised separately from the headline metrics. */
  phase: boolean;
}

export interface ScenarioSpec {
  /** Catalogue id — "A2", "D3". The section is its first character. */
  id: string;
  title: string;
  /** How the fixture was sized, for the report. */
  fixture?: string;
  /**
   * Network emulation for this scenario. Cold loads want `fast3g`, because
   * localhost otherwise hides every byte of transfer cost; anything CPU-bound
   * wants `none`, because emulation there adds only variance.
   */
  network?: NetworkName;
  repeats?: number;
  /**
   * Absolute ceilings, by metric name. Seeds from the design doc until a
   * baseline exists — see `budgets.ts`.
   */
  budgets?: Record<string, number>;
  /**
   * Lower bounds, by metric name — for the metrics where more is better.
   * A frame rate belongs here, not in `budgets`.
   */
  floors?: Record<string, number>;
  /** Per-metric tolerance override against the baseline. */
  tolerances?: Record<string, number>;
  /**
   * Skip the automatic vitals/long-task/network collection.
   *
   * For the two scenarios that never open a browser tab in anger — the
   * delivery audit and the bundle budget — where an LCP of `undefined` in the
   * results file is just noise.
   */
  manualMetricsOnly?: boolean;
}

/** What a scenario body is handed. */
export interface Sample {
  page: Page;
  cdp: CDPSession;
  request: APIRequestContext;
  /** 0-based, and `-1` for the discarded warm-up. */
  iteration: number;
  isWarmup: boolean;

  /** Record a number for this iteration. */
  record(name: string, value: number, unit?: Unit): void;
  /** Time an async block, record it, and return its value. */
  time<T>(name: string, fn: () => Promise<T>): Promise<T>;

  /**
   * Put the browser back to a first-ever-visit state, so the next navigation
   * pays full transfer cost. See the implementation for why this is three
   * things and not one.
   */
  coldStart(): Promise<void>;
  /** Drop everything the in-page observers have collected so far. */
  resetMetrics(): Promise<void>;

  /** JS heap in bytes, after a forced collection. */
  heapUsed(): Promise<number>;

  /**
   * Run `action` while counting animation frames, and record the effective
   * frame rate and dropped-frame ratio.
   */
  frameRate(name: string, action: () => Promise<void>): Promise<void>;

  /** Bytes and request counts seen since the iteration began. */
  traffic(): Promise<Traffic>;
}

export interface Traffic {
  requests: number;
  bytes: number;
  jsBytes: number;
  jsRequests: number;
  imageRequests: number;
  apiRequests: number;
}

export interface Perf {
  /** Run one catalogue scenario end to end. */
  scenario(spec: ScenarioSpec, body: (s: Sample) => Promise<void>): Promise<void>;
}

// ── In-page collection ──────────────────────────────────────────────────────

async function drain(page: Page): Promise<InPageMetrics | null> {
  return page
    .evaluate(() => (window as unknown as { __perf?: InPageMetrics }).__perf ?? null)
    .catch(() => null);
}

/** The last report for each vital — with `reportAllChanges` that is the final value. */
function lastVital(metrics: InPageMetrics, name: string): number | undefined {
  for (let i = metrics.vitals.length - 1; i >= 0; i -= 1) {
    if (metrics.vitals[i].name === name) return metrics.vitals[i].value;
  }
  return undefined;
}

/**
 * INP, computed from the `event` entries rather than taken from `web-vitals`.
 *
 * `web-vitals` reports INP as a *monotonic worst case* for the page: it only
 * calls back when an interaction beats the previous worst. That is the right
 * definition in the field and the wrong one here, because almost every
 * interaction scenario opens the page, waits for it to settle, calls
 * `resetMetrics()` and then does the thing it is measuring. The reset clears
 * our buffer but not the library's internal high-water mark, so an interaction
 * faster than something that happened during page load reports nothing at all
 * — and `B5` failed with "budgets `inp` but no iteration recorded it" rather
 * than with a number.
 *
 * Computing it from the entries makes it per-measurement. The grouping by
 * `interactionId` is the part that matters: one interaction dispatches several
 * `event` entries (`pointerdown`, `pointerup`, `click`), and INP is the
 * duration of the slowest *interaction*, not of the slowest event.
 *
 * The 98th-percentile rule for pages with many interactions is deliberately not
 * applied: a scenario here performs a handful on purpose, and the worst of them
 * is exactly what the budget is about.
 */
function interactionToNextPaint(metrics: InPageMetrics): number | undefined {
  const worstPerInteraction = new Map<number, number>();
  for (const event of metrics.events) {
    if (!event.interactionId) continue;
    worstPerInteraction.set(
      event.interactionId,
      Math.max(worstPerInteraction.get(event.interactionId) ?? 0, event.duration),
    );
  }
  if (worstPerInteraction.size === 0) return undefined;
  return Math.max(...worstPerInteraction.values());
}

/**
 * Total blocking time: how much of the main thread's long-task time was
 * actually unavailable to the user.
 *
 * The 50 ms subtraction is what makes it "blocking" rather than "busy" — a
 * task under 50 ms does not delay a response perceptibly, and counting it
 * would make a page that does a lot of small work look like one that hangs.
 */
function totalBlockingTime(metrics: InPageMetrics): number {
  return metrics.longTasks.reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0);
}

// ── The fixture ─────────────────────────────────────────────────────────────

export const test = base.extend<{ perf: Perf }>({
  perf: async ({ page, context, request }, use, testInfo) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    // `Network.emulateNetworkConditions` and `Network.clearBrowserCache` are
    // both no-ops while the Network domain is disabled — they return success
    // and change nothing. That failure is silent and expensive: every
    // cold-load scenario reports a warm localhost load and a plausible-looking
    // number, so nothing about the run says the throttling never happened.
    await cdp.send('Network.enable');

    // `D4` puts a TSV block on the clipboard so the paste it measures is the
    // real paste path rather than a synthetic event. Without the grant the
    // write rejects and the scenario measures a paste of nothing.
    await context
      .grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL })
      .catch(() => {
        // Not fatal on its own — D4 asserts on what it actually pasted.
      });

    // Ahead of the instrumentation, so `window.webVitals` exists when it runs.
    await context.addInitScript({ content: WEB_VITALS_SOURCE });
    await context.addInitScript(installInPageInstrumentation, {
      phasePrefix: PHASE_PREFIX,
      eventThresholdMs: EVENT_REPORTING_FLOOR_MS,
    });

    /**
     * Traffic accounting.
     *
     * Each finished request is recorded as a row whose byte count is still a
     * promise — `sizes()` is async and must not block the event handler. The
     * rows are what an iteration owns, rather than a set of running totals:
     * a request that starts in one iteration and finishes in the next would
     * otherwise have its bytes added to whichever total the closure happened
     * to be pointing at, which is how `jsBytes` came out negative the first
     * time this ran.
     */
    interface RequestRow {
      url: string;
      type: string;
      bytes: Promise<number>;
    }
    let rows: RequestRow[] = [];
    const onFinished = (req: import('@playwright/test').Request): void => {
      rows.push({
        url: req.url(),
        type: req.resourceType(),
        bytes: req
          .sizes()
          // A cached or aborted request can report a negative body size; it
          // means "no bytes crossed the wire", which is zero.
          .then((s) => Math.max(0, s.responseBodySize))
          .catch(() => 0),
      });
    };
    page.on('requestfinished', onFinished);

    /**
     * Everything that should fail the test, raised together at teardown.
     *
     * Collected rather than thrown so that a broken scenario costs its own
     * measurements and not the section's.
     */
    const failures: string[] = [];

    const perf: Perf = {
      async scenario(spec, body) {
        const startedAt = new Date().toISOString();
        const startedMs = Date.now();
        const repeats = spec.repeats ?? REPEATS;
        const networkName = spec.network ?? 'none';
        const profile = NETWORK[networkName] ?? null;

        // Every reading, keyed by metric name, one array per name.
        const readings = new Map<string, { unit: Unit; phase: boolean; values: number[] }>();
        const loafs: LoafSample[] = [];

        const runIteration = async (iteration: number): Promise<void> => {
          const isWarmup = iteration < 0;
          rows = [];

          // Throttling is on only for the measured body. Sign-in, seeding and
          // navigation done by the spec's setup happen at full speed — they
          // are not what is being measured, and 4× on them costs minutes
          // across a full suite.
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLING });
          if (profile) {
            await cdp.send('Network.emulateNetworkConditions', {
              offline: profile.offline,
              downloadThroughput: profile.downloadThroughput,
              uploadThroughput: profile.uploadThroughput,
              latency: profile.latency,
            });
          }

          const tracing = TRACE_ENABLED && !isWarmup && iteration === repeats - 1;
          const traceEvents: unknown[] = [];
          const onTraceData = (event: { value: unknown[] }): void => {
            traceEvents.push(...event.value);
          };
          if (tracing) {
            cdp.on('Tracing.dataCollected', onTraceData);
            await cdp.send('Tracing.start', {
              transferMode: 'ReportEvents',
              traceConfig: {
                includedCategories: [
                  'devtools.timeline',
                  'disabled-by-default-devtools.timeline',
                  'disabled-by-default-devtools.timeline.frame',
                  'blink.user_timing',
                  'latencyInfo',
                  'v8.execute',
                ],
              },
            });
          }

          const iterationReadings: Reading[] = [];
          const sample = makeSample({
            page,
            cdp,
            request,
            iteration,
            isWarmup,
            readings: iterationReadings,
            traffic: () => readTraffic(),
          });

          try {
            await body(sample);
          } finally {
            if (tracing) {
              await cdp.send('Tracing.end');
              await new Promise((r) => setTimeout(r, 500));
              cdp.off('Tracing.dataCollected', onTraceData);
              writeTrace(spec.id, traceEvents);
            }
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
            if (profile) {
              await cdp.send('Network.emulateNetworkConditions', {
                offline: false,
                downloadThroughput: -1,
                uploadThroughput: -1,
                latency: 0,
              });
            }
          }

          if (isWarmup) return;

          // Auto-collected metrics, unless the scenario is one that never
          // drives a page.
          if (!spec.manualMetricsOnly) {
            const inPage = await drain(page);
            if (inPage) {
              loafs.push(...inPage.loafs);

              const auto: Array<[string, number | undefined, Unit]> = [
                ['lcp', lastVital(inPage, 'LCP'), 'ms'],
                ['fcp', lastVital(inPage, 'FCP'), 'ms'],
                ['ttfb', lastVital(inPage, 'TTFB'), 'ms'],
                // A scenario that declares an `inp` budget interacts by
                // definition, so "no interaction crossed the reporting floor"
                // is a measurement — INP at most 16 ms — and not missing data.
                // Without this the fastest scenarios are the ones that report
                // nothing.
                [
                  'inp',
                  interactionToNextPaint(inPage) ??
                    (spec.budgets?.inp != null ? EVENT_REPORTING_FLOOR_MS : undefined),
                  'ms',
                ],
                // The library's own number, kept beside ours as a cross-check.
                // It is the page's monotonic worst rather than this
                // measurement's, so it is never what a budget judges.
                ['inpPageWorst', lastVital(inPage, 'INP'), 'ms'],
                ['interactionCount', new Set(
                  inPage.events.filter((e) => e.interactionId).map((e) => e.interactionId),
                ).size, 'count'],
                ['cls', inPage.layoutShift, 'ratio'],
                ['tbt', totalBlockingTime(inPage), 'ms'],
                ['longTaskCount', inPage.longTasks.length, 'count'],
                [
                  'longTaskMax',
                  inPage.longTasks.reduce((m, t) => Math.max(m, t.duration), 0),
                  'ms',
                ],
                [
                  'loafMax',
                  inPage.loafs.reduce((m, l) => Math.max(m, l.duration), 0),
                  'ms',
                ],
                [
                  'loafBlockingTotal',
                  inPage.loafs.reduce((s, l) => s + l.blockingDuration, 0),
                  'ms',
                ],
              ];
              for (const [name, value, unit] of auto) {
                if (value == null || Number.isNaN(value)) continue;
                iterationReadings.push({ name, value, unit, phase: false });
              }

              if (inPage.navigation) {
                iterationReadings.push({
                  name: 'domContentLoaded',
                  value: inPage.navigation.domContentLoaded,
                  unit: 'ms',
                  phase: false,
                });
              }

              // Application phases. Several marks with one name inside a single
              // iteration (one `image:resolve` per image, say) are summed:
              // the question the phase answers is "how much of this scenario
              // went there", not "how long was one of them".
              const phaseTotals = new Map<string, number>();
              for (const mark of inPage.marks) {
                phaseTotals.set(
                  mark.name,
                  (phaseTotals.get(mark.name) ?? 0) + mark.duration,
                );
              }
              for (const [name, value] of phaseTotals) {
                iterationReadings.push({ name, value, unit: 'ms', phase: true });
              }
            }

            const t = await readTraffic();
            iterationReadings.push(
              { name: 'bytes', value: t.bytes, unit: 'bytes', phase: false },
              { name: 'jsBytes', value: t.jsBytes, unit: 'bytes', phase: false },
              { name: 'requests', value: t.requests, unit: 'count', phase: false },
            );
          }

          for (const reading of iterationReadings) {
            const bucket = readings.get(reading.name) ?? {
              unit: reading.unit,
              phase: reading.phase,
              values: [],
            };
            bucket.values.push(reading.value);
            readings.set(reading.name, bucket);
          }
        };

        // One warm-up, discarded: the first iteration pays for JIT warm-up, an
        // empty module cache and a cold connection pool, and none of that is
        // what the scenario is about.
        //
        // A body that throws — a selector that stopped matching, a fixture the
        // app would not open — is recorded against this scenario and does not
        // end the section. A section is one test running eight or nine
        // scenarios over a fixture that took minutes to seed, and letting the
        // first failure discard the other eight measurements is how a perf
        // suite becomes something nobody runs. The failures are re-raised
        // together when the test ends (see the teardown below), so nothing is
        // swallowed.
        let bodyError: string | null = null;
        try {
          await runIteration(-1);
          for (let i = 0; i < repeats; i += 1) await runIteration(i);
        } catch (err) {
          // Stripped of ANSI colour here rather than at every reader:
          // Playwright's assertion messages are written for a terminal, and
          // the escape codes are unreadable in `perf-results.json` and worse
          // in a markdown table.
          bodyError = stripAnsi(err instanceof Error ? err.message : String(err));
          console.error(`\n✗  ${spec.id} ${spec.title}\n   ${firstLine(bodyError)}\n`);
        }

        // ── Aggregate and judge ───────────────────────────────────────────
        const baselineFile = loadBaseline(machineClass(), CPU_THROTTLING, SCALE_NAME);
        const summarise = (
          name: string,
          bucket: { unit: Unit; values: number[] },
        ): MetricSummary => {
          const floor = spec.floors?.[name];
          const summary: MetricSummary = {
            metric: name,
            unit: bucket.unit,
            direction: floor != null ? 'higher-is-better' : 'lower-is-better',
            samples: bucket.values,
            median: median(bucket.values),
            min: Math.min(...bucket.values),
            max: Math.max(...bucket.values),
            cv: coefficientOfVariation(bucket.values),
            unstable: false,
            budget: floor ?? spec.budgets?.[name],
            verdict: 'no-budget',
          };
          return judge(
            summary,
            baselineFile?.metrics[metricKey(spec.id, name)],
            spec.tolerances?.[name] ?? DEFAULT_TOLERANCE,
          );
        };

        const metrics: MetricSummary[] = [];
        const phases: MetricSummary[] = [];
        for (const [name, bucket] of readings) {
          (bucket.phase ? phases : metrics).push(summarise(name, bucket));
        }
        metrics.sort((a, b) => a.metric.localeCompare(b.metric));
        phases.sort((a, b) => a.metric.localeCompare(b.metric));

        // A budget naming a metric nothing recorded is a spec bug — the metric
        // was renamed, or the body never reached the code that records it —
        // and silently passing it is how a suite ends up asserting nothing.
        // Not checked when the body already failed: nothing was recorded
        // because the scenario did not run, which is the error already held.
        if (!bodyError) {
          for (const name of [
            ...Object.keys(spec.budgets ?? {}),
            ...Object.keys(spec.floors ?? {}),
          ]) {
            if (readings.has(name)) continue;
            failures.push(
              `${spec.id} budgets "${name}" but no iteration recorded it`,
            );
          }
        }

        const attribution = await resolveWorstFrames(request, loafs);

        const result: ScenarioResult = {
          id: spec.id,
          title: spec.title,
          section: spec.id[0],
          fixture: spec.fixture ?? null,
          repeats,
          cpuThrottling: CPU_THROTTLING,
          network: networkName,
          metrics,
          attribution,
          phases,
          startedAt,
          durationMs: Date.now() - startedMs,
          error: bodyError,
        };
        recordScenario(result);
        await testInfo.attach(`${spec.id}-metrics.json`, {
          body: JSON.stringify(result, null, 2),
          contentType: 'application/json',
        });

        report(result, attribution);

        if (bodyError) {
          failures.push(`${spec.id} ${spec.title}: ${firstLine(bodyError)}`);
        }

        const breached = metrics.filter((m) => m.verdict === 'fail');
        if (breached.length > 0) {
          const lines = breached.map((m) => `  ${m.metric}: ${m.note}`).join('\n');
          const message = `${spec.id} ${spec.title}\n${lines}`;
          // Advisory by default, per §9 — measured, reported, not blocking.
          // `PERF_ENFORCE=1` promotes a breach to a failure once the machine's
          // noise floor is understood.
          if (ENFORCE) failures.push(message);
          else console.warn(`\n⚠︎  perf budget exceeded (advisory)\n${message}\n`);
        }

        const improved = metrics.filter(isImprovement);
        if (improved.length > 0) {
          console.log(
            `↓  ${spec.id} improved on baseline: ` +
              improved.map((m) => m.metric).join(', ') +
              ' — re-run with --update-baselines to ratchet',
          );
        }
      },
    };

    await use(perf);

    page.off('requestfinished', onFinished);
    await cdp.detach().catch(() => {});

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} perf scenario(s) failed in this section:\n` +
          failures.map((f) => `\n• ${f}`).join(''),
      );
    }

    async function readTraffic(): Promise<Traffic> {
      const snapshot = rows.slice();
      const sizes = await Promise.all(snapshot.map((r) => r.bytes));
      const total = blankTraffic();
      snapshot.forEach((row, i) => {
        const bytes = sizes[i];
        total.requests += 1;
        total.bytes += bytes;
        if (row.type === 'script') {
          total.jsRequests += 1;
          total.jsBytes += bytes;
        }
        if (row.type === 'image') total.imageRequests += 1;
        if (row.url.includes('/api/v1/')) total.apiRequests += 1;
      });
      return total;
    }
  },
});

export { expect };

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Playwright's assertion messages are terminal-coloured; files are not. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001B\[[0-9;]*m/g, '');
}

/** The first non-empty line — what a summary row has room for. */
function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim().length > 0)?.trim() ?? text;
}

function blankTraffic(): Traffic {
  return {
    requests: 0,
    bytes: 0,
    jsBytes: 0,
    jsRequests: 0,
    imageRequests: 0,
    apiRequests: 0,
  };
}

function makeSample(args: {
  page: Page;
  cdp: CDPSession;
  request: APIRequestContext;
  iteration: number;
  isWarmup: boolean;
  readings: Reading[];
  traffic: () => Promise<Traffic>;
}): Sample {
  const { page, cdp, request, iteration, isWarmup, readings } = args;

  const record = (name: string, value: number, unit: Unit = 'ms'): void => {
    readings.push({ name, value, unit, phase: false });
  };

  return {
    page,
    cdp,
    request,
    iteration,
    isWarmup,
    record,

    async time(name, fn) {
      const start = Date.now();
      const value = await fn();
      record(name, Date.now() - start, 'ms');
      return value;
    },

    /**
     * A genuine cold start — HTTP cache, Cache Storage, and service worker.
     *
     * `Network.clearBrowserCache` alone is not enough, and the way it fails is
     * silent. `web/apps/web/public/sw.js` is a hand-rolled **cache-first**
     * service worker for the whole app shell: every JS, CSS and HTML response
     * is served out of Cache Storage when it is there. Cache Storage is not
     * the HTTP cache, so CDP does not clear it; and a response the service
     * worker answers from cache never reaches the network stack, so it is not
     * throttled either.
     *
     * The first version of this measured a "cold load of /sign-in over Fast
     * 3G" at 256 ms and 51 kB against a route F2 measures at 1.8 MB of JS,
     * with a perfectly plausible-looking LCP. Everything after the discarded
     * warm-up was being served by the service worker.
     *
     * The registration is removed rather than merely emptied because the app
     * re-registers on every load (`ServiceWorkerRegister.tsx`); a fresh
     * registration with an empty cache is exactly what a first visit gets.
     */
    async coldStart() {
      // `caches` and `navigator.serviceWorker` are origin-scoped, so there has
      // to be a document on the origin to reach them.
      if (!page.url().startsWith('http')) await page.goto('/sign-in');

      await page.evaluate(async () => {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((r) => r.unregister()));
        }
        if (typeof caches !== 'undefined') {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
      });
      await cdp.send('Network.clearBrowserCache');
    },

    async resetMetrics() {
      await page.evaluate(() => {
        (window as unknown as { __perfReset?: () => void }).__perfReset?.();
      });
    },

    async heapUsed() {
      // Without the collection this reports whatever has not been swept yet,
      // which on a scenario that just tore down an editor is most of it.
      await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
      const { metrics } = await cdp.send('Performance.getMetrics');
      return metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0;
    },

    async frameRate(name, action) {
      await page.evaluate(() => {
        const w = window as unknown as { __perfFrames?: number[] };
        w.__perfFrames = [];
        const tick = (t: number): void => {
          w.__perfFrames!.push(t);
          if (w.__perfFrames!.length < 100_000) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      const start = Date.now();
      await action();
      const elapsed = Date.now() - start;

      const frames = await page.evaluate(() => {
        const w = window as unknown as { __perfFrames?: number[] };
        const captured = w.__perfFrames ?? [];
        w.__perfFrames = [];
        return captured.length;
      });

      // 60 Hz is what Chromium presents at headfully and headlessly alike here,
      // so the expected count is the wall time in 16.67 ms slices. A ratio of
      // zero means every frame the compositor asked for was produced.
      const expected = Math.max(1, (elapsed / 1000) * 60);
      record(`${name}Fps`, (frames / elapsed) * 1000, 'fps');
      record(`${name}DroppedRatio`, Math.max(0, 1 - frames / expected), 'ratio');
    },

    traffic: args.traffic,
  };
}

function writeTrace(id: string, events: unknown[]): void {
  const dir = path.join(PERF_DIR, 'traces');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify({ traceEvents: events }));
  console.log(`   trace → ${file} (open in DevTools ▸ Performance)`);
}

/** The per-scenario console block. The run's markdown summary is `summarize.ts`. */
function report(result: ScenarioResult, attribution: ResolvedFrame[]): void {
  const icon = { pass: '✓', fail: '✗', unstable: '~', 'no-budget': '·' } as const;
  const rows = [...result.metrics, ...result.phases]
    .map((m) => {
      const p75 = percentile(m.samples, 75);
      const extra = m.note ? `  — ${m.note}` : '';
      return (
        `   ${icon[m.verdict]} ${m.metric.padEnd(26)} ` +
        `median ${m.median.toFixed(1)}  p75 ${p75.toFixed(1)}  ` +
        `cv ${(m.cv * 100).toFixed(0)}%${extra}`
      );
    });
  console.log(`\n${result.id} ${result.title}`);
  console.log(rows.join('\n'));

  if (attribution.length > 0) {
    console.log('   slowest frames:');
    for (const frame of attribution.slice(0, 3)) {
      const where = frame.source
        ? `${frame.source.file}:${frame.source.line}`
        : `${frame.chunk.split('/').pop()} @ ?`;
      console.log(
        `     ${frame.duration.toFixed(0)} ms  ${frame.functionName}  ${where}`,
      );
    }
  }
}
