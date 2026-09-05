# Performance suite

The implementation of [`agent_docs/performance-testing.md`](../../agent_docs/performance-testing.md).
Read that first — it is the design, the reasoning and the scenario catalogue. This file is how to
run the thing and what to know before trusting a number it prints.

Playwright drives Chromium through CDP; the attribution comes from the `web-vitals` attribution
build plus `PerformanceObserver`. It reuses the functional suite's Docker stack, `RUN_DIR`
convention and E2EE fixtures rather than standing up a parallel rig.

## Running it

```bash
cd e2e

./scripts/run-perf.sh                            # full suite, 5 repeats + a discarded warm-up
./scripts/run-perf.sh --skip-build               # reuse the :test images
./scripts/run-perf.sh --grep "D3"                # one scenario
./scripts/run-perf.sh --grep "@smoke"            # the quick lane

PERF_SCALE=smoke PERF_REPEATS=1 ./scripts/run-perf.sh --skip-build   # does it still work?
PERF_TRACE=1 ./scripts/run-perf.sh --grep "D3"                       # + a Chrome trace
PERF_SCALE=full ./scripts/run-perf.sh                                # the design doc's sizes
```

Artifacts land under `$RUN_DIR/perf/`:

| File | What it is |
|---|---|
| `perf-results.json` | Every metric, every repeat, with the throttle rate, scale and machine class |
| `perf-summary.md` | The readable table, the verdict, and the source-mapped slow frames |
| `traces/<id>.json` | `PERF_TRACE=1` only — load it in DevTools ▸ Performance |

## Environment

| Variable | Default | Effect |
|---|---|---|
| `PERF_SCALE` | `default` | `smoke` (seconds, numbers meaningless), `default`, `full` (the doc's sizes) |
| `PERF_REPEATS` | `5` | Measured iterations per scenario, after the discarded warm-up |
| `PERF_CPU_THROTTLE` | `4` | CDP CPU throttling multiplier |
| `PERF_ENFORCE` | unset | `1` makes a budget breach fail the test instead of warning |
| `PERF_TOLERANCE` | `0.2` | How far over baseline a metric may drift |
| `PERF_UNSTABLE_CV` | `0.15` | Above this coefficient of variation a metric is quarantined |
| `PERF_MACHINE` | derived | Pins the baseline key; set it on a CI runner |
| `PERF_TRACE` | unset | `1` emits a Chrome trace for the last repeat of each scenario |

The scale name, throttle rate and machine class are all part of the baseline key, so a `smoke` run
can never be compared against — or overwrite — a real measurement.

## Budgets and baselines

Two different numbers, doing two different jobs.

A **budget** is an absolute ceiling written into the spec. Every budget in the suite today is a
*seed* from §5 of the design doc — a common threshold, not a measurement of this app. A **floor** is
the same thing for the metrics where more is better (frame rate).

A **baseline** is what this machine last measured, and it is what actually catches regressions,
because it is the only number with the machine's own noise floor in it. A metric fails if it is
over its budget, or more than the tolerance away from its baseline. A metric with neither is
measured, recorded and reported — never failed.

```bash
./scripts/run-perf.sh --write-baselines    # replace the baseline with this run (phase 3)
./scripts/run-perf.sh --update-baselines   # ratchet downwards only
```

Neither happens on its own. A suite that silently rewrote its own baseline would ratchet a slow
regression in one 19% step at a time and report green throughout.

**The suite is advisory by default** (§9): a breach warns and the test passes. Set `PERF_ENFORCE=1`
once the variance on the machine in question is understood.

## Adding a scenario

```ts
test('X1 what it is', async ({ perf, page, request }) => {
  const session = await signIn(request, page, 'x1');
  await seedFiles(session, 'M');

  await perf.scenario(
    { id: 'X1', title: '…', fixture: 'M', budgets: { inp: 200 } },
    async (s) => {
      await page.goto('/drive');
      await waitForIdle(page);
      await s.resetMetrics();
      await s.time('theThing', () => doTheThing(page));
    },
  );
});
```

The fixture handles throttling, `web-vitals` injection, the warm-up, the repeats, the median, the
stability check, source-mapping the slow frames, the verdict and the results file. LCP, FCP, INP,
CLS, TBT, long tasks, longest animation frame, bytes, requests and every `neutrino:` phase mark are
collected automatically; `s.record` / `s.time` add scenario-specific ones.

A budget naming a metric no iteration recorded fails the scenario. That is deliberate: a renamed
metric would otherwise turn a budget into a no-op silently.

Sections B–E each seed **one** account and run every scenario in the section against it. Seeding an
L fixture is minutes of uploads and paying it per scenario would make the suite unrunnable.

## Things that are true and non-obvious

**The service worker will lie to you.** `web/apps/web/public/sw.js` is a cache-first service worker
for the whole app shell. Cache Storage is not the HTTP cache, so `Network.clearBrowserCache` does
not touch it, and a response the worker answers never reaches the network stack, so it is not
throttled either. `s.coldStart()` unregisters the worker, empties Cache Storage *and* clears the
HTTP cache. The first version of this suite reported a "cold load of /sign-in over Fast 3G" at
256 ms and 51 kB for a route that is 1.8 MB of JS — everything after the warm-up was coming from
the worker, and nothing about the numbers said so.

**Network emulation is a no-op without `Network.enable`.** `Network.emulateNetworkConditions` and
`Network.clearBrowserCache` both return success and change nothing while the domain is disabled.
The fixture enables it; this is here so nobody removes that line.

**Cold loads have a warm code cache.** The repeats share a browser context, so V8 has already
compiled the chunks by the time the measured iterations run. That is what the design doc's
discarded warm-up asks for — but it does mean a cold-load scenario reports few or no long tasks,
because script *compilation* is where they mostly come from. LCP, bytes and time-to-first-row are
measured honestly; "what does a genuinely first-ever visit cost to compile" is a question this
suite does not answer.

**Seeding must match how the app stores each format.** Docs, Sheets and Slides store OOXML (issue
#127) and their bodies are sealed, so those fixtures are built with `docx`/`xlsx`/`pptxgenjs` and
encrypted. The native JSON types — `x-neutrino-doc`, `-diagram`, `-drawing`, notes — are seeded by
the *server* in plaintext (`default_content` in `native_types.rs`) and encrypted by the client's
first save, so seeding those sealed makes the editor render a paragraph of binary.

**Multipart field order is load-bearing.** The upload handler streams the request and acts on the
file part as it arrives, so `folder_id` has to precede `file`. Put it after and the upload succeeds,
the file lands in the root, and a folder-scoped fixture is silently empty.

**`ttfb` against a localhost stack is not a metric.** Its median is a couple of milliseconds and its
coefficient of variation is therefore meaningless. It is collected, and it is only flagged unstable
when something is actually judging it.

**Phase marks live on the document, and some phases only happen once.** `window.__perf` is
re-created by every navigation, so a scenario that navigates three times reports the marks from the
third. And a phase can be genuinely absent rather than missing: `doc:parse` fires on a *first* open
only, because the editor saves the document shortly after opening it and its own `writeDocx` embeds
a `neutrino/model.json` sidecar that every later open prefers over parsing the OOXML.

**`--skip-build` measures the last image you built, not your working tree.** The suite runs against
the Docker stack, so a change to `web/` or `src/` is invisible until the image is rebuilt. This is
usually what you want while iterating on a *scenario*, and exactly wrong when you have changed the
*app* — the giveaway is a phase table that is empty after you added the marks that fill it. Drop
`--skip-build` for a run that has to see product changes.

## Attribution — from "slow" to a line of code

The ladder in §7 of the design doc, and what the suite gives you at each rung:

1. **The slow frames in `perf-summary.md`.** The `web-vitals` attribution build reports the script
   and function that blocked the frame; `sourcemap.ts` resolves the hashed chunk and character
   offset to a file and line. This needs browser source maps in the build under measurement — set
   `productionBrowserSourceMaps: true` in `next.config.ts` for that build. Without them the report
   still names the chunk and the function, just not the file.
2. **The phase marks.** `performance.measure` pairs named `neutrino:*` in the product code are
   collected and reported per scenario, splitting a slow document open into fetch / decrypt /
   parse / paint.
3. **`A6`'s coverage numbers**, if the route got heavier as well as slower.
4. **`PERF_TRACE=1`**, for anything the first three do not explain.
5. **React commit profiling**, when the trace says the time is in render/commit rather than in our
   own functions.
