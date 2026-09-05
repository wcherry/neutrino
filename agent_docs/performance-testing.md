# Performance testing

**Status:** **implemented** — phases 1–5 of §10 are in `e2e/perf/`. See
[`e2e/perf/README.md`](../e2e/perf/README.md) for how to run it, and
[§13](#13-what-building-it-changed) for what building it changed about this plan. Phase 6 (CI) is
deliberately not done; phase 7 (the fix cycle) is the work this unblocks.
**Scope:** the web front end (`web/`) as served in production. Backend load testing is explicitly out of scope — see [Out of scope](#out-of-scope).

> **Two of the findings in §8 are now known to be wrong.** Response compression and
> `Cache-Control: immutable` were both added to `src/main.rs` between this document being written
> and the suite being built, and `F1` passes against them. They are left in §8 with corrections
> rather than deleted, because "the suite killed two hypotheses on its first run" is the thing
> §8 was for.

---

## 1. Recommendation in one paragraph

**Yes, Playwright is the right call** — but Playwright alone only tells you *that* something is slow. Use Playwright as the driver, and drive Chromium through **CDP** (Chrome DevTools Protocol) for the attribution data: CPU throttling, network emulation, JS coverage, heap metrics, and — the important one — the **`web-vitals` attribution build**, which reports not just an INP number but the *script URL and function* that blocked the frame. That is what turns "the sheet feels laggy" into "`recalcDependents` in `formula.ts` held the main thread for 380 ms". Add two cheap non-browser lanes alongside it: a **static bundle budget** check on the build output, and an **asset-delivery audit** of the response headers. Reject Lighthouse as the primary tool — it scores page loads, and almost all of this app's cost is in post-load interaction.

---

## 2. What we are working with

Facts that shape the design (verified by reading the code, not assumed):

| Fact | Where | Why it matters for perf testing |
|---|---|---|
| Next 15 **static export** (`output: 'export'`), served by `actix-files` from the Rust binary | [next.config.ts](web/apps/web/next.config.ts), [src/main.rs:1126-1141](src/main.rs#L1126-L1141) | No SSR. First paint is gated on JS download → hydrate → client-side auth → API round-trips. All the interesting cost is client-side. |
| ~~No `Compress` middleware, no `Cache-Control` on static assets (ETag + Last-Modified only)~~ — **stale.** `Compress::default()` is registered, and an `immutable_cache_control` middleware stamps `public, max-age=31536000, immutable` onto `/_next/static/*` | [src/main.rs](src/main.rs) | Asset delivery is still a lane worth having — `F1` is what keeps it true. |
| E2EE runs **in the browser** (libsodium), on the main thread | `packages/e2e-crypto`, `lib/driveImages.ts` | Decrypt cost is user-visible jank, not server load. Must be measured with real bytes. |
| `SheetGrid` **is** virtualized (`computeViewport`/`lowerBound`) | [SheetGrid.tsx:167-181](web/apps/web/src/app/(apps)/sheets/editor/SheetGrid.tsx#L167-L181) | Scroll should be flat with sheet size — worth asserting, so it stays that way. |
| `FileGrid` and the photos grid are **not** virtualized — `loading="lazy"` on thumbs only | [FileGrid.tsx:263](web/packages/ui/src/components/display/FileGrid.tsx#L263), [photos/page.tsx:599](web/apps/web/src/app/(apps)/photos/page.tsx#L599) | Prime suspect for large-library slowness. Needs scale fixtures. |
| Only 6 `next/dynamic` call sites; 59 `await import(` | `apps/web/src` | Route-level code splitting is thin. Bundle-per-route is worth measuring. |
| Editors are very large single components — DocEditor 2921 lines, SlideEditor 2549, DiagramCanvas 2111, SheetEditor 2029 | `apps/web/src/app/(apps)/*/editor/` | Re-render cost concentrates here; these are where interaction latency tests pay off. |
| Playwright harness already exists: Docker stack on `:9880`, `RUN_DIR` artifacts, per-test console + network capture | [e2e/](e2e/) | The perf suite should reuse all of it rather than build a parallel rig. |
| Test stack runs on **localhost** | [e2e/docker-compose-test.yml](e2e/docker-compose-test.yml) | Network is unrealistically fast. Emulation is mandatory, not optional. |

---

## 3. Tooling decision

### Chosen

| Tool | Role | Why |
|---|---|---|
| **Playwright** (`@playwright/test` ^1.49, already installed) | Driver, fixtures, reporting, artifact capture | Already the E2E harness. Same auth helpers, same Docker stack, same `RUN_DIR` conventions. Chromium-only is fine — CDP is the point. |
| **CDP session** (`context.newCDPSession(page)`) | Throttling, tracing, metrics | `Emulation.setCPUThrottlingRate`, `Network.emulateNetworkConditions`, `Performance.getMetrics`, `Tracing.start/end`. No extra dependency. |
| **`web-vitals` (attribution build)**, injected per page | LCP / CLS / INP with **attribution** | v4+ attribution gives `attribution.longAnimationFrames` → the script URL, function name and duration that blocked the interaction. This is the "narrow down to the slow parts" mechanism. |
| **`PerformanceObserver`** in-page | `longtask`, `long-animation-frame`, `event`, `measure` | Catches jank outside a specific interaction (autosave ticks, background decrypt). |
| **`page.coverage.startJSCoverage()`** | Unused bytes per chunk, per route | Directly answers "what are we shipping that this route never runs". |
| **`performance.mark` / `measure`** added at ~15 product call sites | Application-level phases | Lets us say "document load = 1.2 s, of which decrypt 700 ms, ProseMirror parse 300 ms" instead of one opaque number. Small, permanent product change. |
| **`size-limit`** (or the existing `@next/bundle-analyzer` output) | Static per-entry byte budgets | Runs in seconds with no browser. Catches "someone imported `xlsx` into the shell" before a browser test ever has to. |

### Rejected, and why

- **Lighthouse / Lighthouse CI as the primary tool.** It measures cold page loads and produces a composite score. This app's pain is post-load interaction inside editors, which Lighthouse never reaches. Its numbers are also noisier run-to-run than direct CDP metrics. *Possible narrow use:* one Lighthouse run against the signed-out shell, purely to catch delivery regressions (compression, caching, render-blocking). Optional; `playwright-lighthouse` would bolt it onto the same suite if we want it.
- **Cypress.** No comparable CDP depth, no trace export, and we would be running two E2E frameworks.
- **Puppeteer.** Same capability as Playwright+CDP with none of the existing harness.
- **k6 browser / Selenium Grid.** Built for concurrency against a server; wrong axis for front-end main-thread cost.
- **React DevTools programmatic profiler.** Genuinely useful for commit-level attribution, but it needs a profiling build and a second capture path. Hold it in reserve for step 4 of the attribution playbook, once the LoAF data points at a specific component.

---

## 4. Suite architecture

### Placement

A **new Playwright project** inside the existing `e2e/` config, not a new repo area:

```
e2e/
  playwright.config.ts        # the "perf" project, selected by PERF=1
  scripts/run-perf.sh         # what `cargo perf` runs
  perf/
    README.md                 # how to run it, and what to know before trusting a number
    fixtures/
      perf.ts                 # the rig: throttle, instrument, repeat, judge, record
      instrument.ts           # what runs in the page, before the app does
      env.ts                  # every knob, and the only reader of process.env
      session.ts              # one signed-in account + the keypair to seal fixtures for it
      seed.ts                 # API-level fixture generators
      documents.ts            # the fixture bytes — .docx / .xlsx / .pptx / JSON / images
      actions.ts              # the page-driving vocabulary the scenarios share
      budgets.ts              # budgets, floors, baselines, the ratchet
      results.ts              # perf-results.json, medians, coefficient of variation
      sourcemap.ts            # hashed chunk + offset → file:line
      types.ts
      assets/                 # committed JPEGs, so the photo fixture is identical every run
    scenarios/
      shell.spec.ts           # A1–A7
      drive.spec.ts           # B1–B6
      docs.spec.ts            # C1–C8
      sheets.spec.ts          # D1–D9
      media.spec.ts           # E1–E7
      cross-cutting.spec.ts   # F3–F6
      delivery.spec.ts        # F1–F2, no interaction
    baselines/
      <machine-class>.json    # written by --write-baselines; none committed yet
    report/
      summarize.ts            # run JSON → markdown table + regression verdict
```

Two departures from the sketch above, both explained in §13: `vitals.ts` folded into
`instrument.ts` (the `web-vitals` callbacks and the `PerformanceObserver`s are one init script and
splitting them only made the ordering harder to see), and the per-app spec files are grouped by
section rather than by app, because a section shares one seeded account.

Rationale for a separate project rather than tagged tests in the existing suite: perf tests need different `use` options (no `trace: 'on'` — tracing distorts the measurement), longer timeouts, throttling, and repeat runs. Mixing them into the functional project would slow every PR run and make the functional traces useless.

### Run modes

| Mode | Command | Repeats | When |
|---|---|---|---|
| Smoke | `cargo perf --grep @smoke` | 1 | Optional on PR, informational only |
| Full | `cargo perf` | 5, median reported | Nightly and on demand |
| Attribution | `PERF_TRACE=1 cargo perf --grep "<name>"` | 1 | When investigating one regression; emits a Chrome trace to load in DevTools |

`cargo perf` is the counterpart to `cargo e2e` — an xtask alias that forwards everything after it
to `e2e/scripts/run-perf.sh`, which is equally runnable on its own from `e2e/`.

### Environment controls (every run)

- Fixed viewport `1440×900`, `deviceScaleFactor: 1`.
- **CPU throttling `4×`** by default. Two reasons: it makes a fast dev machine behave like a mid-range laptop, and it *amplifies* main-thread cost so regressions clear the noise floor. Record the rate in the result so numbers are never compared across rates.
- **Network emulation** — a "Fast 3G"-ish profile for cold-load scenarios (localhost otherwise hides all transfer cost), and unthrottled for pure-CPU interaction scenarios.
- One warm-up iteration per scenario, discarded, so the first-run JIT and cache penalty doesn't land in the sample.
- `workers: 1` (inherited) — parallel workers on one machine contaminate every timing.
- All fixture data seeded **through the API**, never through the UI, so setup cost never enters the measurement and the fixture is identical every run.

---

## 5. What we measure

### Metric families

| Family | Metrics | Collected via |
|---|---|---|
| **Cold load** | TTFB, FCP, LCP (+ element), DOMContentLoaded, load, time-to-interactive-proxy (first idle after hydration), total bytes, request count | Navigation Timing + `web-vitals` + `page.on('response')` |
| **Interaction latency** | INP per interaction class, plus `event` timing entries; p75 across repeats | `web-vitals` attribution + `PerformanceObserver('event')` |
| **Main-thread health** | Total blocking time, long-task count and max duration, longest animation frame, script attribution | `PerformanceObserver('longtask'\|'long-animation-frame')` |
| **Rendering** | Frames rendered during a scripted scroll, dropped-frame ratio, layout-shift score | CDP `Tracing` frame events; CLS from `web-vitals` |
| **Application phases** | `neutrino:doc:load`, `neutrino:doc:decrypt`, `neutrino:sheet:recalc`, `neutrino:autosave`, `neutrino:image:resolve`, … | `performance.measure` marks added to product code, drained after each scenario |
| **Payload** | JS transferred per route, unused-byte ratio per chunk, largest chunks | `page.coverage`, `size-limit` |
| **Memory** | JS heap after N navigations, heap delta across an open/close cycle, detached-node count | CDP `Performance.getMetrics`, `HeapProfiler` |
| **Delivery** | `content-encoding`, `cache-control`, `etag`, uncompressed vs compressed size per asset | Response headers, no interaction needed |

### On budgets

Every scenario below carries a **seed budget**. These are starting points chosen from common thresholds (INP ≤ 200 ms good / ≤ 500 ms poor; LCP ≤ 2.5 s), **not measurements of this app**. The first implementation step is to run the suite and replace every seed with `measured_median × 1.25`, committed to `baselines/`. From then on the budget is a **ratchet**: a run fails if it exceeds the baseline by more than the tolerance, and a run that comes in materially *under* the baseline updates it. This is the only way to get a signal that doesn't drown in machine noise.

---

## 6. Scenario catalogue

Fixture sizes are named — `S` / `M` / `L` — and defined once in `seed.ts`.

### A. Shell and navigation

| # | Scenario | Fixture | Primary metric | Seed budget |
|---|---|---|---|---|
| A1 | Cold load of `/sign-in`, empty cache, Fast 3G | — | LCP, total JS bytes | LCP ≤ 2.5 s |
| A2 | Cold load of `/drive` authenticated, empty cache | 50 files | LCP, time to first row painted | LCP ≤ 3.0 s |
| A3 | Warm load of `/drive` (service worker + HTTP cache primed) | 50 files | LCP, bytes from network | ≤ 20% of A2 bytes |
| A4 | Client-side nav `/drive → /docs → /sheets → /calendar → /drive` | S | Per-hop transition time, chunk bytes per hop, long tasks per hop | ≤ 400 ms/hop |
| A5 | Sidebar/topbar re-render cost on route change | S | Long-animation-frame count | 0 frames > 100 ms |
| A6 | Shell JS unused-byte ratio at `/drive` | — | Unused bytes from coverage | Report only initially |

### B. Drive and file listings — *unvirtualized grid, prime suspect*

| # | Scenario | Fixture | Primary metric | Seed budget |
|---|---|---|---|---|
| B1 | `/drive` render with 100 / 1 000 / 5 000 files | S/M/L | Time to interactive; assert **sub-linear** growth | 5 000 ≤ 3× the 100 time |
| B2 | Scroll the full L listing at a fixed rate | L | Dropped-frame ratio, max long task | < 10% dropped |
| B3 | Switch view Large grid → Small grid → Detailed list on L | L | Interaction latency per switch | ≤ 200 ms |
| B4 | Sort and filter-chip toggle on L (client-side sort path) | L | INP | ≤ 200 ms |
| B5 | Open the right-click menu on a row in L | L | INP | ≤ 100 ms |
| B6 | Thumbnail load storm — how many image requests fire before first paint | L | Request count in the first 2 s | Report, then budget |

### C. Docs editor

| # | Scenario | Fixture | Primary metric | Seed budget |
|---|---|---|---|---|
| C1 | Open an encrypted doc: 20 / 500 / 2 000 paragraphs | S/M/L | `doc:load` phase breakdown (fetch / decrypt / parse / first paint) | L ≤ 2.0 s |
| C2 | Sustained typing (60 chars) in an L doc | L | INP p75, LoAF script attribution | INP ≤ 200 ms |
| C3 | Typing while an autosave tick fires | L | Max long task during the tick | ≤ 100 ms |
| C4 | Open a doc containing 20 encrypted Drive images | Images | `image:resolve` total, main-thread block from decrypt | ≤ 3.0 s to all resolved |
| C5 | Apply a paragraph style / heading across a large selection | L | INP | ≤ 200 ms |
| C6 | Insert and resize a table in an L doc | L | INP | ≤ 200 ms |
| C7 | Export to PDF | M | Wall time, peak heap | Report, then budget |
| C8 | Spell/grammar check pass over an L doc | L | Long tasks on the main thread | 0 tasks > 200 ms |

### D. Sheets

| # | Scenario | Fixture | Primary metric | Seed budget |
|---|---|---|---|---|
| D1 | Open a sheet with 1 k / 20 k / 100 k populated cells | S/M/L | Time to first grid paint; assert flat-ish (grid is virtualized) | L ≤ 2× S |
| D2 | Scroll vertically 200 rows and horizontally 50 columns on L | L | Dropped frames, `computeViewport` cost | < 10% dropped |
| D3 | Edit one cell that 5 000 formulas depend on | L | `sheet:recalc` measure, INP | ≤ 300 ms |
| D4 | Paste a 1 000 × 20 block | M | Wall time, max long task | ≤ 1.5 s |
| D5 | Apply conditional formatting across 50 k cells | L | Rule-eval time, scroll frames after | ≤ 500 ms |
| D6 | Insert / delete a row on L (structural shift) | L | INP | ≤ 300 ms |
| D7 | Render a chart over a 10 k-point range | M | Time to chart painted | ≤ 800 ms |
| D8 | Multi-select many row/column headers *(new in `1920261`)* | L | INP | ≤ 200 ms |
| D9 | Sheet autosave on an L file (serialize + encrypt + upload) | L | Main-thread block during autosave | ≤ 150 ms |

### E. Slides, diagrams, drawing, photos

| # | Scenario | Fixture | Primary metric | Seed budget |
|---|---|---|---|---|
| E1 | Open a 100-slide deck | L | Time to first slide editable; thumbnail rail paint | ≤ 2.5 s |
| E2 | Navigate between slides in a 100-slide deck | L | INP per slide change | ≤ 150 ms |
| E3 | Drag an element on a slide with 50 elements | M | Frame rate during drag | ≥ 50 fps effective |
| E4 | Diagram canvas: drag a node in a 200-node diagram (Konva) | L | Frame rate during drag, long tasks | ≥ 50 fps |
| E5 | Photos grid with 200 / 2 000 encrypted photos | M/L | Time to first row, scroll frames, heap | Sub-linear growth |
| E6 | Photo editor: open + one filter on a 12 MP image | — | Decrypt + decode + filter apply | Report, then budget |
| E7 | Presenter view open on a 100-slide deck | L | Time to ready, heap delta | Report |

### F. Cross-cutting

| # | Scenario | Fixture | Primary metric | Seed budget |
|---|---|---|---|---|
| F1 | **Delivery audit** — every asset on `/drive`: encoding, cache headers, size | — | Assert `content-encoding` present on JS/CSS; assert `cache-control: immutable` on `/_next/static/*` | Currently expected to **fail** — see §8 |
| F2 | **Bundle budget** — bytes per route entry from the export output | — | Per-route first-load JS | Ratchet |
| F3 | **Memory sweep** — 20 navigations across all apps | S | Heap after forced GC vs. baseline | Growth ≤ 20% |
| F4 | **Editor open/close leak** — open and close a doc 10× | M | Heap delta per cycle, detached nodes | Flat |
| F5 | Encrypt/decrypt throughput: 1 MB / 50 MB upload and download | — | MB/s, longest main-thread block | Block ≤ 50 ms |
| F6 | Search across a large corpus | L | Time to first result, INP while typing | ≤ 300 ms |
| F7 | Takeout import of a 2 GB archive | L | Peak heap (the zip.js property that `archive.test.ts` protects) | Peak ≤ 1.5× largest entry |

---

## 7. Attribution playbook — going from "slow" to a line of code

The suite is only worth building if a red result names a culprit. The escalation ladder, in order of cost:

1. **Read the LoAF attribution.** The `web-vitals` attribution build reports, for the frame that blew the INP budget, the script URL, the function name, and the time split between script / style-and-layout / paint. In a static export the URL is a hashed chunk, so the suite keeps the build's source maps as a run artifact and resolves the frame to a real file and line before reporting. This resolves most cases with no further work.
2. **Read the application phase marks.** The `performance.measure` pairs in the product code (§5) split a slow document open into fetch / decrypt / parse / paint. This is why the marks are worth adding permanently — they make the common regressions self-diagnosing.
3. **Diff the JS coverage.** If a route got slower *and* heavier, coverage says which chunk arrived and how much of it ran.
4. **Re-run with `PERF_TRACE=1`.** Emits a full Chrome trace to `RUN_DIR`; open it in DevTools' performance panel and read the bottom-up tree. Use for anything the first three steps don't explain.
5. **React commit profiling.** Last resort, when the trace shows the time is in React's render/commit rather than in our own functions — the answer is then a memoization or a state-colocation problem, and the profiler names the component.

Each perf spec should record enough for step 1 to happen from the CI artifact alone, without a local repro.

---

## 8. Findings already visible from reading the code

These are **hypotheses, not measurements**. They are listed because they shaped the scenario list, and each one has a scenario that will confirm or kill it. Do not fix any of them before the suite can show the before/after.

1. ~~**No response compression.**~~ **Killed.** `Compress::default()` is registered and chunks ship
   `content-encoding: br`. `F1` measured 74 text assets on `/drive`, 0 of them uncompressed.
2. ~~**No `Cache-Control` on static assets.**~~ **Killed.** `immutable_cache_control` stamps
   `public, max-age=31536000, immutable` onto the hashed assets; `F1` measured 61 of them, 0
   without it. `A3` puts the practical effect at a warm load costing **0.6% of the cold load's
   bytes** — though most of that credit belongs to the service worker rather than to the HTTP
   cache (see §13).
3. **`FileGrid` renders every row.** No windowing — only `loading="lazy"` on thumbnails, which defers image bytes but not DOM nodes or React work. Large Drive accounts and the photos library are the exposure. → **B1, B2, E5**
4. **Thin route-level code splitting.** Six `next/dynamic` sites against a dependency list that includes `konva`, `xlsx`, `pdfmake`, `docx`, `pptxgenjs`, `mammoth`, `recharts`, `leaflet`, `nspell` and `dictionary-en`. Whether these actually reach the shell bundle is exactly what F2 and A6 answer.
   **Confirmed, and it is the largest single finding so far.** `F2`'s first run, in bytes of JS
   referenced by each route's export entry:

   | Route | First-load JS |
   |---|---|
   | `/sheets/editor` | 2.84 MB |
   | `/docs/editor` | 2.68 MB |
   | `/drive` | 2.16 MB |
   | `/slides/editor` | 2.14 MB |
   | `/docs`, `/sheets`, `/slides`, `/notes` (landing pages) | ~2.08 MB each |
   | `/sign-in` | **1.80 MB** |
   | Distinct chunks across all routes | 4.16 MB |

   The signed-out sign-in page pulling 1.8 MB, and every landing page being within 5% of every
   other, is the shape of a shell that carries most of the app. `A1` puts the user-visible cost at
   **LCP 3.2 s over Fast 3G at 4× CPU**; `A2` at **LCP 4.6 s, first Drive row at 5.1 s**.
5. **E2EE decrypt on the main thread.** Every encrypted read decrypts in the page. A worker would fix it if measurement justifies the move. → **F5, C4, E5**
6. **Autosave under a large document** re-serializes, re-encrypts and uploads on a debounce timer; the cost scales with document size and lands on the main thread mid-typing. → **C3, D9**
7. **Very large editor components.** 2 000–2 900-line components tend to re-render broadly. Whether that is a real cost is a measurement question, not a style question. → **C2, D3, E2**

8. **New, and not a hypothesis — a measurement.** **Under 4× CPU throttling the
   Slides editor opens a stored `.pptx` as the default blank deck.** `E1` seeds a
   six-slide deck and the rail reports one slide; the same fixture, the same
   code and the same account at `PERF_CPU_THROTTLE=1` reports six. Both the
   content (`GET /drive/files/{id}`) and the key (`GET …/key`) return 200, and
   no autosave follows, so **the stored file is not modified** — this is a read
   race, not data loss. The shape of `SlideEditor`'s load effect fits: it holds
   the DEK in a *ref*, so an effect run that happens before the key resolves
   reads ciphertext, fails to unzip it, and leaves the default presentation on
   screen with nothing to re-trigger the read. A slow machine is exactly where
   that ordering changes. Not fixed here — §8's rule is that nothing is fixed
   before the suite can show the before and after, and this is the first thing
   the suite found that the reading of the code had not. → **E1, E2, E7**

---

## 9. CI and reporting

*Everything below is the design; **the workflow itself is deferred to issue #196**, with the
reasoning in §12.1. The mechanisms it needs — `PERF_MACHINE`, `PERF_ENFORCE`, `PERF_TOLERANCE`,
the artifacts, the ratchet flags — are all in place.*

- **New workflow**, nightly plus `workflow_dispatch`, on a **fixed runner class** — perf numbers are not comparable across machine types, and the baseline file is keyed by machine class for that reason.
- **Not a required PR check** initially. Run it in advisory mode for two weeks, watch the variance, and only then set tolerances and make it blocking. A blocking perf check with an unmeasured noise floor gets disabled within a month.
- **Output artifacts** per run, under the existing `RUN_DIR` convention: `perf-results.json` (every metric, every repeat, plus the throttle rate and machine class), a markdown summary table, resolved LoAF attributions, and traces when `PERF_TRACE=1`.
- **Verdict logic:** fail on `median > baseline × (1 + tolerance)` where tolerance defaults to 20% and is per-metric overridable; fail on any absolute budget breach; auto-update the baseline on a run that improves it by more than 10%.
- **Flaky quarantine:** a scenario whose coefficient of variation across the 5 repeats exceeds 15% is reported as unstable and excluded from the verdict rather than failing the run. Track those separately — high variance is itself a finding.

---

## 10. Implementation phases

| Phase | Contents | Status |
|---|---|---|
| **1 — Rig** | `perf` Playwright project, `perf.ts` fixture (throttle, vitals injection, metric drain, repeat-and-median), `seed.ts` API fixtures, results JSON + markdown summarizer. | **Done** — `e2e/perf/fixtures/`, `e2e/perf/report/` |
| **2 — Delivery lane** | F1 and F2. No browser interaction, fast to write. | **Done** — and it killed §8 findings 1 and 2 on its first run |
| **3 — Baselines** | Run the suite, commit `baselines/<machine-class>.json`, replace every seed budget with a measured one. | **Mechanism done**, no baseline committed — see below |
| **4 — Scenario build-out** | Sections A–F. | **Done** — 30 scenarios across six spec files |
| **5 — Product marks** | `performance.mark`/`measure` pairs in the editors, crypto helpers and image resolver. | **Done**, as its own commit — see §14 |
| **6 — CI** | Nightly workflow, advisory mode, artifact upload, summary comment. | **Deferred** — issue #196 |
| **7 — Fix cycle** | Act on what the numbers show, each fix landing alongside its before/after from the suite. | This is what the above unblocks |

**No baseline file is committed, deliberately.** A baseline is keyed by machine class, CPU throttle
rate and fixture scale, and one recorded on a developer's laptop would be compared against nothing
else — while looking authoritative in the repository. The first machine that runs the suite in
earnest should write its own with `--write-baselines`; until then every budget in the specs is a
seed from §5 and the suite reports rather than judges.

---

## 11. Out of scope

- **Backend load and latency testing.** The Rust API's throughput is a different question with different tools (`oha` or `k6` against the API directly). It matters, because a slow endpoint will show up in these tests as front-end slowness and get misattributed — so the perf fixture records server timing per request, letting us tell the two apart. But building the load suite is separate work.
- **The iOS and macOS clients** (`neutrino_notes_ios_mobile`, `neutrino_docs_ios_mobile`, `neutrino_drive_mac_desktop`) — native profiling, entirely different tooling.
- **Real-user monitoring.** Everything here is lab measurement. Field data is worth doing eventually and is a separate proposal.
- **Cross-browser.** Chromium only, matching the existing suite. Firefox/WebKit lack the CDP attribution data, so a perf suite there would be numbers without explanations.

---

## 12. Open questions — resolved

1. **Where does CI run?** *Deferred, deliberately.* The suite runs locally and on demand; no
   workflow was added. Tracked as **issue #196** so the runner-class decision is made once there is
   variance data to make it with, rather than guessed now. `PERF_MACHINE` exists so a runner can pin
   its own baseline key when that happens.
2. **Are the product `performance.mark` calls acceptable?** *Yes* — added, in their own commit, so
   the product-code change is reviewable apart from the harness. See §14.
3. **How large is a realistic large account?** *Still a guess, but no longer a blocker.* The sizes
   are configurable (`PERF_SCALE`), the default is smaller than this document proposed so a full
   run stays usable, and `PERF_SCALE=full` restores the numbers here. The assertions that matter —
   `B1`'s growth ratio, `D1`'s flatness — are about *shape* and hold at either scale.
4. **Advisory or blocking, and when?** *Advisory*, and it is the default (`PERF_ENFORCE=1` opts
   in). Nothing should block on a noise floor nobody has measured yet.
5. **Is the Lighthouse lane wanted at all?** *No*, as recommended. `F1` covers it.

---

## 13. What building it changed

Six things the plan did not anticipate. All of them are in the code with the reasoning attached;
this is the summary.

**The service worker invalidates any naive cold-load measurement.** `web/apps/web/public/sw.js` is
a hand-rolled **cache-first** service worker for the whole app shell. Cache Storage is not the HTTP
cache, so CDP's `Network.clearBrowserCache` does not touch it — and a response the worker answers
never reaches the network stack, so network emulation does not apply to it either. Before this was
found, the suite reported a "cold load of `/sign-in` over Fast 3G" at **256 ms and 51 kB**, for a
route `F2` measures at 1.8 MB. Both numbers were plausible and both were meaningless. `coldStart()`
now unregisters the worker, empties Cache Storage and clears the HTTP cache; the honest figure is
3.2 s and 578 kB. This also reframes §8 finding 2: repeat visits were already cheap, but because of
the service worker rather than because of `Cache-Control`.

**`Network.emulateNetworkConditions` is a silent no-op without `Network.enable`.** It returns
success and changes nothing. Same for `Network.clearBrowserCache`.

**Cold-load scenarios have a warm V8 code cache.** The repeats share a browser context, so the
chunks are already compiled when the measured iterations run — which is exactly what §4's discarded
warm-up asks for, and does mean a cold-load scenario reports few long tasks, because compilation is
where most of them come from. LCP, bytes and time-to-first-row are unaffected. "What does a
genuinely first-ever visit cost to compile" is a question this suite does not answer, and saying so
is better than reporting a number that looks like an answer.

**Seeding has to match how the app stores each format, and the halves differ three ways.** Docs,
Sheets and Slides store OOXML and seal it, so those fixtures are built with
`docx`/`xlsx`/`pptxgenjs` and encrypted from Node using the account's own keypair. The native JSON
types are seeded by the *server* in plaintext (`default_content` in `native_types.rs`) and
encrypted by the client's first save — seed one of those sealed and the editor renders a paragraph
of binary, which is how the first `C4` run failed. And a native type is *created* through
`POST /drive/files` rather than uploaded, so the record exists in the state its editor is written
to open.

The models themselves have to be exact, too. A diagram shape carrying `text` where `DiagramShape`
declares `label`, or a partial `ShapeStyle`, does not degrade: the editor renders straight from the
stored model and the page dies with "Application error: a client-side exception has occurred". A
fixture generator is a second implementation of a format, and it is worth writing it against the
type rather than against a plausible reading of the default content.

**Drive's listing pages at 200 and never windows.** §8 finding 3 is confirmed and sharper than
stated: the cost of a large account does not arrive on load, it arrives as the user scrolls, onto a
list that is never trimmed. `B1`/`B2` drive the pagination to the end rather than measuring the
first screenful. Folder navigation is `useState`, not a route, so `B1` compares three sizes by
clicking into three folders — which isolates grid rendering from page load, and is the better
measurement anyway.

**E4's diagram canvas is SVG, not Konva.** `DiagramCanvas` works in `svg`; Konva is the Drawing
app. The scenario list gained `E4b` for the Konva case rather than conflating them.

**Measuring INP takes more care than "read it from `web-vitals`".** Two defaults work against a
lab suite, and both fail by reporting *nothing* rather than by reporting something wrong:

- `web-vitals` reports INP as a **monotonic worst case for the page**, calling back only when an
  interaction beats the previous worst. Almost every interaction scenario loads a page, waits for
  it to settle, clears the buffer and then does the thing it is measuring — and an interaction
  faster than something that happened during page load reports nothing at all. INP is therefore
  computed from the `event` entries, grouped by `interactionId`, per measurement. The library's
  number is kept beside it as `inpPageWorst` and never judged.
- A `PerformanceObserver` on `event` has a default `durationThreshold` of **104 ms**, so a 40 ms
  interaction produces no entry. The threshold is set to 16 ms, the lowest the spec allows, and a
  scenario that budgets `inp` but sees no entry above it records 16 — meaning "at most this".

**A broken scenario must not cost the section its measurements.** Sections B–E are one test each,
running eight or nine scenarios over a fixture that took minutes to seed. `perf.scenario` records a
body that throws as a failed scenario and carries on; the failures are re-raised together when the
test ends. Playwright's default action timeout is also *no timeout*, so before this one bad
selector consumed the whole 45-minute budget and discarded everything the section had already
measured — the perf project sets `actionTimeout` and `expect.timeout` to 30 s for that reason.

### Structural departures from §4

- **Sections B–E are one test each**, seeding one account and running every scenario in the section
  against it. Seeding an L fixture is minutes of uploads; paying it per scenario made the suite
  unrunnable.
- **The repeats live inside the fixture**, not in `repeatEach`. Playwright would run five separate
  tests, and there would be nowhere to compute a median.
- **The perf project replaces the functional one** when `PERF=1`, rather than sitting beside it.
  Playwright runs every configured project by default, so a bare `playwright test` would otherwise
  pick up the perf suite.
- **`F7` (2 GB takeout import) is not implemented.** `archive.test.ts` already asserts the streaming
  property in seconds; reproducing it here would cost minutes and gigabytes per run to re-assert the
  same thing with a noisier measurement. The reasoning is recorded at the foot of
  `cross-cutting.spec.ts` so the decision is visible rather than looking like an omission.
- **Budgets gained floors.** A frame rate is a lower bound; judging it as a ceiling would pass a
  scenario that dropped to 10 fps.

---

## 14. Product instrumentation

Phase 5 of §10 — the `performance.mark`/`measure` pairs — lands as its own commit. Every mark is
named `neutrino:<app>:<phase>`, which is the prefix `e2e/perf/fixtures/instrument.ts` filters on;
anything else in the buffer is Next's own instrumentation and third-party libraries, and collecting
it would make the phase table unreadable.

They are unconditional and permanent. `performance.mark` on a page with no observer is a few
microseconds and no allocation, and the alternative — inferring phases from a trace — is
significantly weaker attribution for anyone reading a CI artifact rather than reproducing locally.
