# Performance testing

**Status:** proposal, for review before implementation.
**Scope:** the web front end (`web/`) as served in production. Backend load testing is explicitly out of scope — see [Out of scope](#out-of-scope).

---

## 1. Recommendation in one paragraph

**Yes, Playwright is the right call** — but Playwright alone only tells you *that* something is slow. Use Playwright as the driver, and drive Chromium through **CDP** (Chrome DevTools Protocol) for the attribution data: CPU throttling, network emulation, JS coverage, heap metrics, and — the important one — the **`web-vitals` attribution build**, which reports not just an INP number but the *script URL and function* that blocked the frame. That is what turns "the sheet feels laggy" into "`recalcDependents` in `formula.ts` held the main thread for 380 ms". Add two cheap non-browser lanes alongside it: a **static bundle budget** check on the build output, and an **asset-delivery audit** of the response headers. Reject Lighthouse as the primary tool — it scores page loads, and almost all of this app's cost is in post-load interaction.

---

## 2. What we are working with

Facts that shape the design (verified by reading the code, not assumed):

| Fact | Where | Why it matters for perf testing |
|---|---|---|
| Next 15 **static export** (`output: 'export'`), served by `actix-files` from the Rust binary | [next.config.ts](web/apps/web/next.config.ts), [src/main.rs:1126-1141](src/main.rs#L1126-L1141) | No SSR. First paint is gated on JS download → hydrate → client-side auth → API round-trips. All the interesting cost is client-side. |
| No `Compress` middleware, no `Cache-Control` on static assets (ETag + Last-Modified only) | [src/main.rs](src/main.rs#L1126-L1141) | Asset delivery is a measurable, fixable lane on its own. |
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
  playwright.config.ts        # + a "perf" project, testDir ./perf
  perf/
    fixtures/
      perf.ts                 # extends fixtures/base.ts — adds metrics collection
      seed.ts                 # API-level fixture generators (files, docs, sheets, photos)
      vitals.ts               # injects web-vitals attribution build, drains to Node
    scenarios/
      shell.spec.ts
      drive.spec.ts
      docs.spec.ts
      sheets.spec.ts
      slides.spec.ts
      photos.spec.ts
      crypto.spec.ts
      delivery.spec.ts        # header/compression/bundle audit — no interaction
    baselines/
      <machine-class>.json    # committed; the ratchet
    report/
      summarize.ts            # run JSON → markdown table + regression verdict
```

Rationale for a separate project rather than tagged tests in the existing suite: perf tests need different `use` options (no `trace: 'on'` — tracing distorts the measurement), longer timeouts, throttling, and repeat runs. Mixing them into the functional project would slow every PR run and make the functional traces useless.

### Run modes

| Mode | Command | Repeats | When |
|---|---|---|---|
| Smoke | `pnpm perf --grep @smoke` | 1 | Optional on PR, informational only |
| Full | `./scripts/run-perf.sh` | 5, median reported | Nightly and on demand |
| Attribution | `PERF_TRACE=1 ./scripts/run-perf.sh --grep "<name>"` | 1 | When investigating one regression; emits a Chrome trace to load in DevTools |

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

1. **No response compression.** [src/main.rs](src/main.rs) registers `Logger` and `NormalizePath` but no `Compress` middleware, and `actix_files::Files` does not compress on its own. Every JS chunk appears to ship uncompressed. If true this is the single largest cold-load win available and costs one line. → **F1**
2. **No `Cache-Control` on static assets.** The static service sets `use_etag` and `use_last_modified` only. Content-hashed `/_next/static/*` files should be `immutable, max-age=31536000`; as configured, every repeat visit spends a revalidation round-trip per asset. → **F1, A3**
3. **`FileGrid` renders every row.** No windowing — only `loading="lazy"` on thumbnails, which defers image bytes but not DOM nodes or React work. Large Drive accounts and the photos library are the exposure. → **B1, B2, E5**
4. **Thin route-level code splitting.** Six `next/dynamic` sites against a dependency list that includes `konva`, `xlsx`, `pdfmake`, `docx`, `pptxgenjs`, `mammoth`, `recharts`, `leaflet`, `nspell` and `dictionary-en`. Whether these actually reach the shell bundle is exactly what F2 and A6 answer.
5. **E2EE decrypt on the main thread.** Every encrypted read decrypts in the page. A worker would fix it if measurement justifies the move. → **F5, C4, E5**
6. **Autosave under a large document** re-serializes, re-encrypts and uploads on a debounce timer; the cost scales with document size and lands on the main thread mid-typing. → **C3, D9**
7. **Very large editor components.** 2 000–2 900-line components tend to re-render broadly. Whether that is a real cost is a measurement question, not a style question. → **C2, D3, E2**

---

## 9. CI and reporting

- **New workflow**, nightly plus `workflow_dispatch`, on a **fixed runner class** — perf numbers are not comparable across machine types, and the baseline file is keyed by machine class for that reason.
- **Not a required PR check** initially. Run it in advisory mode for two weeks, watch the variance, and only then set tolerances and make it blocking. A blocking perf check with an unmeasured noise floor gets disabled within a month.
- **Output artifacts** per run, under the existing `RUN_DIR` convention: `perf-results.json` (every metric, every repeat, plus the throttle rate and machine class), a markdown summary table, resolved LoAF attributions, and traces when `PERF_TRACE=1`.
- **Verdict logic:** fail on `median > baseline × (1 + tolerance)` where tolerance defaults to 20% and is per-metric overridable; fail on any absolute budget breach; auto-update the baseline on a run that improves it by more than 10%.
- **Flaky quarantine:** a scenario whose coefficient of variation across the 5 repeats exceeds 15% is reported as unstable and excluded from the verdict rather than failing the run. Track those separately — high variance is itself a finding.

---

## 10. Implementation phases

| Phase | Contents | Rough size |
|---|---|---|
| **1 — Rig** | `perf` Playwright project, `perf.ts` fixture (throttle, vitals injection, metric drain, repeat-and-median), `seed.ts` API fixtures, results JSON + markdown summarizer. Two scenarios end-to-end (A2, C2) to prove the pipeline. | Largest single chunk |
| **2 — Delivery lane** | F1 and F2. No browser interaction, fast to write, and likely to surface the compression/caching findings immediately. | Small |
| **3 — Baselines** | Run phase 1+2 five times, commit `baselines/<machine-class>.json`, replace every seed budget with a measured one. | Small |
| **4 — Scenario build-out** | Sections A–F in priority order: Drive (B) → Sheets (D) → Docs (C) → Slides/Photos (E) → cross-cutting (F). | Incremental, one spec at a time |
| **5 — Product marks** | Add the ~15 `performance.mark`/`measure` pairs to the editors, crypto helpers and image resolver. Behind no flag; `performance.mark` is free when nothing observes it. | Small, touches product code |
| **6 — CI** | Nightly workflow, advisory mode, artifact upload, summary comment. | Small |
| **7 — Fix cycle** | Only now: act on what the numbers show, with each fix landing alongside its before/after from the suite. | Ongoing |

Phases 1–3 are the minimum useful deliverable — after them we have real numbers for the shell, one editor, and asset delivery, and a mechanism that makes every subsequent scenario cheap to add.

---

## 11. Out of scope

- **Backend load and latency testing.** The Rust API's throughput is a different question with different tools (`oha` or `k6` against the API directly). It matters, because a slow endpoint will show up in these tests as front-end slowness and get misattributed — so the perf fixture records server timing per request, letting us tell the two apart. But building the load suite is separate work.
- **The iOS and macOS clients** (`neutrino_notes_ios_mobile`, `neutrino_docs_ios_mobile`, `neutrino_drive_mac_desktop`) — native profiling, entirely different tooling.
- **Real-user monitoring.** Everything here is lab measurement. Field data is worth doing eventually and is a separate proposal.
- **Cross-browser.** Chromium only, matching the existing suite. Firefox/WebKit lack the CDP attribution data, so a perf suite there would be numbers without explanations.

---

## 12. Open questions

1. **Where does CI run?** The baseline mechanism needs a stable runner class. GitHub-hosted runners are noisy; a self-hosted runner would give tighter tolerances. This decides whether tolerance is 20% or 10%.
2. **Are the product `performance.mark` calls acceptable?** They are permanent, tiny, and unconditional. The alternative — inferring phases from traces — is significantly weaker attribution.
3. **How large is a realistic large account?** The `L` fixture sizes above (5 000 Drive files, 100 k cells, 2 000 photos, 100 slides) are guesses. Real numbers from actual usage would make the budgets meaningful.
4. **Advisory or blocking, and when?** Recommendation is advisory for two weeks, then blocking. Worth confirming.
5. **Is the Lighthouse lane wanted at all?** Recommendation is no, with the delivery audit (F1) covering what we would actually use it for.
