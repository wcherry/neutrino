# UI performance roadmap

**Status:** proposal, 2026-10-21. **Scope:** the web client (`web/`) as served in production —
static export behind the Rust binary. Native clients are out of scope.
**Companions:** [`ui-roadmap.md`](ui-roadmap.md) (how this interacts with the
look-and-feel and customization work), [`ui-customization-roadmap.md`](ui-customization-roadmap.md),
and [`performance-testing.md`](performance-testing.md), which is the *instrument* this document
reads. That document built the suite and stopped at "phase 7 — the fix cycle". This is phase 7.

The rule from `performance-testing.md` §8 still holds and is the spine of this plan: **nothing here
gets fixed without a scenario that shows the before and after.** Every item below names the
scenario that proves it.

---

## 1. How the numbers were taken

A fresh production build (`pnpm build`, commit `d3b6499`) served by the Rust binary on `:9880`,
measured by the existing `e2e/perf` suite in real Chromium through CDP, not by reading code.

| Knob | Value | Why it matters |
|---|---|---|
| Machine | `darwin-arm64-apple-m2-8x` | Numbers are comparable only against this machine class. |
| CPU throttle | 4× | The suite default — a mid-range laptop, and it amplifies main-thread cost above noise. |
| Network | Fast 3G for cold loads, unthrottled otherwise | Localhost hides transfer cost otherwise. |
| Scale | `PERF_SCALE=default` (Drive L = 1 000 files, Docs L = 1 000 paragraphs, Sheets L = 50 000 cells) | `full` would be harsher; the growth-shape assertions hold at either. |
| Repeats | 3 + a discarded warm-up | Fewer than the suite's 5, to keep the run under 20 minutes. CVs are reported; unstable metrics are flagged. |
| Server | **debug** build of `neutrino` | API latency is pessimistic. Every finding below is main-thread or payload cost, which the server build does not affect — but don't read server-bound timings (A2's first row, D9's round trip) as production numbers. |

It was run against a local server rather than the Docker stack (the daemon was down), through a
wrapper config that drops `global-setup.ts`'s `docker compose up` and nothing else. Results:
16 sections, 14 passed; the two failures are single scenarios, C5 and E4b, both triaged in
Stage 0 (P2 and "Instrument gaps" below).

**No baseline was written**, for the reason `performance-testing.md` §10 gives: one laptop's
numbers committed as a baseline look authoritative and compare against nothing. The first job of
§6 phase 0 is to produce one on the machine that will keep running the suite.

---

## 2. The findings, ranked by what a user feels

| # | Area | What a user sees | Evidence (median, 4× CPU) | Size of the fix |
|---|---|---|---|---|
| **P1** | Drive listings | Large folders stutter on scroll, and switching view freezes for a second | B1 1 000-row render **4.1 s** (growth 8.4× from 25 rows); B2 **38 fps, 36 % frames dropped**; B3 view switch INP **1 080 ms**; B5 context menu **894 ms** to open | Medium — one component |
| **P2** | Docs editor | Typing lags in a long document; tables and undo stall | C2 typing INP **312 ms**, **10.2 s** of blocking time over 60 characters; C6 grow table **3.0 s**, undo **3.4 s**; C8 spell-check TBT **4.7 s** | Large — needs attribution first |
| **P3** | Sheets editor | The grid appears fast, then the page is frozen for ~4 s | D1 grid paints at **343 ms**, but D2/D3/D6/D8/D9 all record a **3.7–4.0 s** long animation frame with LCP ~5 s on the same 50 k-cell file; D8 header multi-select INP **1 208 ms** | Medium — once attributed |
| **P4** | First load | Sign-in and Drive take seconds on a slow connection | A1 sign-in LCP **3.2 s** (485 KB JS transferred, 1.77 MB parsed); A2 first Drive row **5.5 s**; F2 shared chunks **4.3 MB** raw | Large — shell restructuring |
| **P5** | Fonts | A slow or blocked Google Fonts host stalls *every* page's first paint | Measured: FCP 3.48 s blocked vs 3.54 s allowed (cheap when healthy) — but **8.3 s with the host stalled 8 s** | Small |
| **P6** | Crypto | A large upload or open blocks input briefly | F5 16 MB decrypt blocks the main thread **208 ms**; 1 MB blocks 0 ms | Medium — worker |

And the things that are **fine and should be protected, not touched** (§5): app-to-app navigation
(A4, every hop ≤ 147 ms), the shell on route change (A5, no frame over 100 ms), slides (E1–E3, E7),
the SVG diagram canvas (E4, 60 fps dragging 200 nodes), the photos grid (E5, 60 fps over 620
encrypted photos), memory (F3 heap +7 % over 20 navigations, F4 no per-open leak), search (F6
first result 297 ms), and sheet open time staying flat with size (D1 0.93 ratio, 1 k → 50 k cells).

---

## 3. Findings in detail

### P1 — Drive listings render every row, and pay for it on every interaction

> **Done in Stage 1** (`useWindowedItems`, memoised rows, `aria-setsize`/`aria-posinset`): B2
> 60 fps / 0 % dropped, B3 INP 112 ms, B5 122 ms. B1 is 715 / 1 100 / 3 132 ms for 25 / 200 /
> 1 000 rows — growth 4.9×, still above the ≤ 2× target; the remainder is five sequential page
> fetches, not rendering. (A first measurement of 2 161 ms came from a scroll helper that could stop
> at the first page of 200; `e2e/perf/fixtures/actions.ts` now scrolls the last rendered row into
> view until `aria-posinset` reaches `aria-setsize`, and the committed baseline uses it.) Details in
> `ui-roadmap.md`, Stage 1.

**Mechanism, confirmed.** `FileGrid` (`packages/ui/src/components/display/FileGrid.tsx`) has no
windowing. My Drive pages at 200 (A7: 201 rows in the DOM after the first page settles) and the
list is never trimmed, so a user who scrolls a large folder accumulates every row. The cost
is not on load — it is on everything afterwards:

- **B1** render time grows **8.4×** from 25 → 1 000 rows (463 ms → 4 055 ms), 14 long tasks, the
  longest 425 ms. The seed budget was ≤ 3× growth.
- **B2** scrolling the loaded list runs at **38 fps with 36 % dropped frames**, one 743 ms task.
- **B3** switching Large → Small → Detailed re-creates all 1 000 cells: INP **1 080 ms**, the
  Large-grid switch alone 1 340 ms.
- **B4** sort by name 664 ms, filter chip 488 ms — client-side sort over the full array plus a full
  re-render.
- **B5** opening a row's context menu takes **894 ms** — opening a menu should cost the menu, not
  the list. That shape says the menu's open state lives high enough to re-render every row.

**What to do.**
1. **Window all three layouts** in `FileGrid`. The list is a fixed-row-height case and the two grids
   are fixed-cell-size cases, so a plain windower (`@tanstack/react-virtual`, which matches the
   TanStack Query already in use) is enough; no variable-height measuring. Row height must come
   from the density token, not from a constant — see §7, this is the first place the
   customization work reaches into performance.
2. **Move the context menu's state down.** One menu instance, portalled, keyed by the row id it
   is open for, so opening it re-renders the menu and the one row that shows the pressed ⋯.
3. **Memoise the domain → `GridItem` mapping** (`drive/gridItems.ts` call sites in `drive/page.tsx`)
   and the handlers passed to `FileGrid` — the item called out in `web-refactor.md` #5, now with
   a number attached.
4. Keep `sortEntries`' client-side path for the views that have no server sort, but sort a memoised
   copy rather than re-deriving on every render.

**Proves it:** B1 growth ≤ 2×, B2 ≥ 55 fps with < 10 % dropped, B3/B4/B5 INP ≤ 200 ms. The rows
in the DOM after scrolling to the bottom (a new metric for B2) should be bounded by the viewport,
not by the folder.

### P2 — Docs typing cost scales with the document

**Mechanism, not yet attributed.** Opening is fine — C1 is flat at ~495 ms from 20 to 1 000
paragraphs, so parse and decrypt are not the problem. The cost is per keystroke:

- **C2** 60 typed characters in a 1 000-paragraph document: INP **312 ms**, **50 long tasks,
  10.2 s total blocking** — roughly 170 ms of main-thread work per character.
- **C3** the same while an autosave fires: max long task 288 ms. Autosave is *not* the main
  contributor; C2 without it is nearly as bad.
- **C6** inserting a table 837 ms, growing it **3.0 s**, undoing it **3.4 s**.
- **C8** spell-check over the document: TBT 4.7 s, 24 long tasks up to 267 ms.

Per-keystroke work proportional to document size, in a ProseMirror editor, almost always means a
plugin that walks the whole document on every transaction — a decoration set rebuilt from scratch,
a full-text derivation (word count, search-index text, outline), or spell-check re-scanning. The
editor has many candidates (`DocEditor.tsx` is ~2 900 lines with `CharacterCount`, the spell-check
pass, `DriveImageExtension`'s node decorations, presence/remote cursors, track changes, the field
extension). **Which one is the cost is exactly what the suite's attribution ladder is for, and the
first rung is currently broken** — see "Instrument gaps" below.

**What to do,** in order:
1. Fix source maps (phase 0), re-run C2 with `PERF_TRACE=1`, and read the bottom-up tree. Do not
   guess at a fix before this.
2. Expected shape of the fix, to be confirmed by step 1: every plugin's `apply` maps its previous
   state through the transaction (`DecorationSet.map`) and recomputes only the changed ranges;
   whole-document derivations (word count, outline, index text) move behind an idle callback or a
   debounce; spell-check moves to a worker (it is pure — `nspell` over strings) and only re-checks
   changed paragraphs.
3. C6's undo at 3.4 s says history steps are heavy for table operations; check whether the table
   plugin dispatches one transaction per cell.

**Proves it:** C2 INP ≤ 100 ms and TBT under 1 s for the 60 characters; C6 grow/undo ≤ 300 ms;
C8 no task over 50 ms.

**C5, triaged in Stage 0 — slow, not hung; and it led to a data-loss bug.** Run alone, applying
Heading 1 across the whole 1 000-paragraph document works and takes **12.4 s** at 4× CPU
(2.8 s unthrottled; 113 ms on the 20-paragraph document) — far over any budget, and a P2 item in
its own right. It only *fails* when C2/C3's typing runs first, and chasing that found the
following, which outranks everything in this document:

> **Typing into a `.docx` the moment it opens can overwrite the stored document.** The editor
> mounts with one empty placeholder paragraph before the file's content is applied. Keystrokes in
> that window go into the empty document, the content is then never applied (the dirty guard keeps
> the "unsaved" typing), and the autosave writes the near-empty document over the file. Measured on
> a seeded 20-paragraph `.docx`: typing at once → **the stored file went from 21 paragraphs to 1**
> (only the typed text); waiting 8 s first → intact. The window was 448 → 503 ms locally and is
> the download-and-decrypt time in general, so longer on a real network and for a larger file.
> It affects the **first open of any `.docx` the app has not yet saved** — every uploaded Word file
> and every Takeout import, which are stored byte for byte. A document the app has already saved
> opens with its content and no window, and immediate typing left it intact. Not fixed in Stage 0;
> tracked as **issue #265**, ahead of every other Docs item.

The scenarios should not be able to trip it either: `openDoc` (`perf/fixtures/actions.ts`) returns
as soon as *a* paragraph is visible, which the placeholder satisfies. It should wait for the
document's own content, or C2–C8 can measure an empty document.

### P3 — Sheets paints fast, then freezes

**Mechanism, partly confirmed.** D1's time to first grid paint is excellent and flat (343 ms at
50 k cells; ratio 0.93 vs 1 k). But every *other* scenario that opens the same 50 k-cell file —
D2, D3, D6, D8, D9 — records a single long animation frame of **3.7–4.0 s** and an LCP of
**4.6–5.1 s**, with *zero* long tasks in some of them (D2). A long animation frame with no long
script task means the time is in **style, layout or paint**, not in JavaScript — a very large
style recalculation or a forced layout over a large DOM, landing right after the first paint D1
measures.

Separately, interaction costs on the L sheet:
- **D8** shift-selecting a run of row headers: INP **1 208 ms**, 2.7 s to settle, a 1 357 ms task.
  `web/CLAUDE.md` describes header selection materialising `MAX_ROWS` ids per column behind
  `useDeferredValue`; the deferral moves the cost, it does not remove it.
- **D7** a chart over 10 k points: 1.5 s to paint, one 624 ms task.
- **D3** recalc after editing a cell many formulas depend on: 452 ms.
- **D9** autosave of the L sheet: a 347 ms main-thread task (serialise + encrypt), 3.4 s round trip
  (server-bound on a debug build).

**What to do.**
1. Trace D2 with `PERF_TRACE=1` and look at the "Recalculate style" / "Layout" entries in the 4 s
   frame. Two prime suspects, both in the grid: the selection/header overlays (inline-styled
   absolutely-positioned divs per `web/CLAUDE.md`) invalidating layout across the whole grid, or a
   style rule matching every cell (`:global([data-theme=…])` descendant selectors over thousands of
   nodes are expensive to match). Fix whichever the trace names; `contain: strict` on the grid
   viewport is the cheap structural guard either way.
2. D8: represent header selection as ranges, never as a materialised id set. The grid already
   paints the highlight from header indices; nothing should need the cell set until an action runs
   on it, and actions can iterate the ranges.
3. D7: downsample (LTTB) series above ~2 k points before handing them to `recharts`.
4. D9: move serialise + encrypt into a worker (it shares the worker with P6).

**Proves it:** no frame over 200 ms in D2's load, LCP within 1.5× of D1's first paint; D8 INP
≤ 200 ms; D7 ≤ 500 ms; D9 longest task ≤ 50 ms.

### P4 — The shell carries most of the app

> **Stage 2:** three root layouts, libsodium on demand, barrel imports tree-shaken, the preview,
> zip and chart stacks lazy, and per-route budgets that fail the build
> (`apps/web/route-budgets.json`). A1 LCP **1.32 s** and F2 sign-in **546 KB raw** are met; A2's
> first row is **3.54 s** (from 5.57 s), short of 2.5 s — see `ui-roadmap.md`, Stage 2, for
> what remains. The 769 KB chunk was libsodium.
>
> **Stage 3:** framer-motion out of the primitives and the shell (CSS keyframes), and the Drive
> listing started from the access token's user id rather than after `/auth/me`. `/drive` first-load
> JS 1 174 → 1 082 KB including the new shell; A2 first row **3.02 s**, LCP 2.79 s — still short of
> 2.5 s. The listing no longer waits for auth; the remainder is script transfer at Fast 3G and the
> first render. Next: the duplicated `/auth/me`, `/preferences` and search-meta requests, and a
> `(mirror)` layout chunk that loads on `/drive` (`ui-roadmap.md`, Stage 3).
>
> **Stage 4:** the duplicate `/auth/me` is gone. B1's scroll helper no longer sets the time it
> measures (it advanced by the window's overscan; the list took six times the passes); B3's large-grid
> switch is 648 → 344 ms after caching date formatters, still over budget (`ui-roadmap.md`, Stage 4).

**Confirmed and unchanged in shape since `performance-testing.md` §8.4.**

| | Raw (parsed) | Transferred |
|---|---|---|
| `/sign-in` first-load JS (F2) | 1.77 MB | 485 KB (A1) |
| `/drive` | 2.31 MB | 680 KB (A2) |
| `/sheets/editor` (heaviest) | 2.80 MB | — |
| Distinct chunks across all routes | 4.33 MB | — |
| Largest single chunk (A6) | 769 KB | — |

A signed-out page parsing 1.77 MB is the tell: `app/layout.tsx` mounts `FeatureFlagsProvider`,
`CustomFontsProvider`, `CustomThemesProvider`, `QueryProvider`, `AuthProvider` and
`ToastProvider` above *every* route, and `(apps)/layout.tsx` pulls the full shell (search index
sync, notifications socket, live updates, upload pipeline, import runner) into every app route.
Cold-load cost: **A1 LCP 3.2 s, A2 LCP 5.0 s and first Drive row 5.5 s** over Fast 3G. Warm loads
are effectively free (A3: 4 KB over the network) thanks to the service worker — so this is a
first-visit and post-deploy problem, which for a self-hosted product with frequent upgrades is
every upgrade.

**What to do.**
1. **Split the public routes off the app shell.** `/sign-in`, `/register`, `/share`, `/self-host`
   get a root that mounts only what they use. Target ≤ 150 KB transferred for sign-in.
2. **Make the shell's heavy members lazy.** The import runner, upload pipeline, search-index sync
   and the editors' export stacks (`pdfmake`, `docx`, `pptxgenjs`, `xlsx`, `mammoth`) load on first
   use. Run `pnpm --filter @neutrino/web analyze` and start with the 769 KB chunk — find out what
   it is before deciding where it goes.
3. **Ratchet it.** Add `size-limit` (or F2's own budgets with `PERF_ENFORCE=1`) per route, so the
   next import of a heavy library into the shell fails a check instead of being found by this
   suite months later.

**Proves it:** A1 LCP ≤ 1.5 s, A2 first row ≤ 2.5 s, F2 sign-in ≤ 600 KB raw, shared chunks
trending down per release.

### P5 — Fonts come from a third party, and block first paint

> **Done in Stage 1**: every family is self-hosted from `@fontsource` (`app/fonts.ts`); sign-in
> fetches four Latin Inter files and nothing else, and F1 now budgets and measures zero third-party
> requests.

**Measured for this document,** with a cold `/sign-in` at Fast 3G and 4× CPU, three runs each:

| Google Fonts host | FCP (median) |
|---|---|
| Reachable | 3 540 ms |
| Blocked (connection refused) | 3 480 ms |
| Stalled for 8 s | **8 280 ms** |

So the healthy cost is small (~60 ms — the first-party JS dominates). The problem is that the
stylesheet is **render-blocking** (`renderBlockingStatus: "blocking"`) and comes from a host
outside the deployment's control. Any network where `fonts.googleapis.com` is slow, filtered or
black-holed — a corporate proxy, an air-gapped self-hosted install, a region that blocks Google —
holds every page's first paint for as long as the connection takes to fail. It is also a privacy
leak for an end-to-end-encrypted product: every page view tells Google the user's IP and that
they use Neutrino.

It also loads five families (Inter, Roboto, Open Sans, Lato, Playfair Display) on every page,
signed-out included; only the Docs/Slides font pickers need the last four.

**What to do.** Self-host Inter as a variable `woff2` from `/_next/static` (immutable-cached
already, `F1`), `font-display: swap`, preloaded. Load the editor fonts on demand when a font picker
opens or a document uses one — the same path `CustomFontsProvider` already uses for admin-imported
fonts. Remove the `fonts.googleapis.com` preconnects.

**Proves it:** a new F1 assertion — zero third-party requests on any route — plus A1 unchanged
or better with the font host stalled.

### P6 — Encryption runs on the main thread

**Confirmed, and smaller than hypothesised.** F5: a 1 MB encrypt/decrypt blocks 0 ms measurably;
16 MB blocks **208 ms** in one task. Photos (E5) holds 60 fps over 620 encrypted photos and the
photo editor opens a 12 MP image in 554 ms (E6), so per-item crypto is not a visible problem
today. It becomes one with large files and with D9's autosave. Move libsodium into one dedicated
worker that also takes serialise-and-encrypt for autosave (P3.4) and spell-check (P2.2); one worker
with a small message protocol, not one per feature.

**Proves it:** F5 max block ≤ 50 ms at 16 MB; D9 longest task ≤ 50 ms.

### Instrument gaps — fix these first

1. ~~**No production source maps.**~~ **Fixed in Stage 0.** `NEUTRINO_BROWSER_SOURCEMAPS=1` turns on
   `productionBrowserSourceMaps`; `run-perf.sh` sets it and the Dockerfile passes it through as a
   build arg that defaults off, so only the image the suite measures carries maps (served beside
   each chunk, which is what `sourcemap.ts` fetches; the export grows to ~63 MB). A frame spent
   *evaluating* a chunk has no character position to map, so `sourcemap.ts` now names the chunk's
   largest packages instead of printing `@ ?`. The first attributed run already says something:
   - **Opening a document evaluates `nspell` — 206 ms on the main thread** (C1). The spell-checker
     loads with the editor; P2's worker plan should take it off the open path entirely.
   - **The first PDF export evaluates `html-to-pdfmake` (688 ms) and `pdfmake` (242 ms)** (C7) —
     one blocking second the first time a user exports.
   - **The longest typing frames are React, not ProseMirror**: 260–287 ms in react-dom's commit
     in C2, C3 and C8 — the editor component re-rendering on each keystroke, which is
     `performance-testing.md` §8 finding 7 confirmed. `src/lib/extensions/PaginationExtension.ts:477`
     is next (14–83 ms; 83 ms in C6's table growth). P2 should start with what `DocEditor`
     re-renders per transaction, then pagination — not with plugin decorations, which the plan
     above guessed at.
2. ~~**C5 and E4b fail.**~~ **Triaged in Stage 0.** C5: see P2 above. E4b was a **broken fixture**:
   `buildDrawing` wrote the old version 1 flat-shape body, which the layer-tree editor refuses
   ("This file is not a drawing this version can open"), so there was never a drawing canvas to
   measure. It is now built with the editor's own `document/factory.ts` and `serializeDocument`, so
   it cannot drift from the format again. With a real drawing: **open 304 ms, pan 62 fps, 0 % dropped**
   — the Konva canvas is healthy.
3. **No baseline and no CI** (issue #196). Baseline: on this Mac, decided in Stage 0; CI stays
   open. Without them, every fix in §6 can regress silently.

---

## 4. Seed budgets → targets

The suite's seed budgets are generic thresholds. These are the targets this roadmap commits to,
to be written into the specs as each phase lands, then ratcheted from measured medians.

| Scenario | Today | Target |
|---|---|---|
| A1 sign-in LCP (Fast 3G) | 3 204 ms | ≤ 1 500 ms |
| A2 first Drive row (Fast 3G) | 5 543 ms | ≤ 2 500 ms |
| B1 1 000-row growth ratio | 8.4× | ≤ 2× |
| B2 scroll dropped frames | 36 % | < 10 % |
| B3 / B5 INP | 1 080 / 328 ms | ≤ 200 / ≤ 100 ms |
| C2 typing INP (1 000 paragraphs) | 312 ms | ≤ 100 ms |
| C6 grow table / undo | 3 014 / 3 433 ms | ≤ 300 ms each |
| D2 longest frame during load | 3 929 ms | ≤ 200 ms |
| D8 header multi-select INP | 1 208 ms | ≤ 200 ms |
| F2 `/sign-in` raw JS | 1 771 KB | ≤ 600 KB |
| F5 16 MB main-thread block | 208 ms | ≤ 50 ms |
| Third-party requests, any route | 2 (font host) | 0 |

---

## 5. What not to break

The protected list from §2 becomes assertions with `PERF_ENFORCE=1` once a baseline exists:
A4 hops ≤ 200 ms, A5 no frame > 100 ms, E3/E4 ≥ 55 fps, E5 ≥ 55 fps, F3 heap growth ≤ 20 %,
F4 flat, D1 open ratio ≤ 1.5. These are the places a broad refactor — the shell split, the token
migration, a new provider — will regress something that currently works.

---

## 6. Phases

| Phase | Contents | Unblocks | Exit criterion |
|---|---|---|---|
| **0 — Instrument** | Hidden source maps for perf builds; triage C5 and E4b; first committed baseline on the runner that will keep it; #196 nightly in advisory mode | Attribution for P2/P3 | Slow frames resolve to `file:line`; C5 root cause known |
| **1 — Quick, certain wins** | P1 windowing + menu state + memoisation; P5 self-hosted fonts | — | B-section targets; zero third-party requests |
| **2 — Shell split** | P4 public-route root, lazy shell members, per-route size budgets | Lowers the floor every later phase measures from | A1/A2/F2 targets; budgets enforced |
| **3 — Docs typing** | P2, driven by the trace | — | C2/C6/C8 targets |
| **4 — Sheets** | P3 frame, header ranges, chart downsampling | — | D2/D7/D8 targets |
| **5 — Crypto worker** | P6 + D9 autosave + spell-check in one worker | — | F5/D9 targets |
| **6 — Enforce** | `PERF_ENFORCE=1` on the protected list and every target met | — | A PR that regresses a budget fails |

Phase 1 goes first because it is certain — the mechanism is confirmed and the fix is local — and
because the windowed list is the component the look-and-feel work will restyle; doing it after
would mean restyling the old one.

---

## 7. Where this meets the other two roadmaps

Full treatment in [`ui-roadmap.md`](ui-roadmap.md); the parts that change what
gets built here:

- **Density drives virtualisation.** Comfortable/compact/spacious modes change row height. The
  windowed `FileGrid` (P1) must read its row and cell sizes from the density tokens at runtime and
  re-measure when density changes — never hard-code 44 px. Build P1 against the token, even before
  the density setting exists.
- **Preferences must not block first paint.** The customization work introduces server-synced
  preferences. Theme, density and look have to be applied synchronously before first paint, from a
  local cache, exactly as the anti-FOUC script does for the theme today; the server copy
  reconciles afterwards. A preferences fetch on the critical path would undo P4.
- **New providers go below the public-route split.** Anything customization adds to the provider
  tree (preferences, command registry, branding) mounts in the app shell, not in `app/layout.tsx`,
  or it lands on `/sign-in` and undoes P4. Instance branding is the one exception, and it ships as
  data in the HTML (see the customization roadmap), not as a provider.
- **Translucency has a GPU price.** The mockups put `backdrop-filter: blur()` on menus, dialogs, the
  command palette and toasts. Blur is paid per frame over the area behind the element. It is cheap
  on a small static popup and expensive on anything that scrolls or animates over a changing
  background. The rule: blur only on transient overlays, never on a sticky header or sidebar over
  scrolling content; fall back to an opaque surface under `prefers-reduced-transparency` and when
  a frame-time probe shows the device is struggling. Add a scenario (a menu open over a scrolling
  B2 list) before shipping it.
- **The command registry replaces 35 `keydown` listeners.** That is a small performance win and the
  customization roadmap's dependency; it should land as one change, not twice.

---

## Appendix — every scenario's medians from this run

4× CPU, `default` scale, 3 repeats, `darwin-arm64-apple-m2-8x`, debug server.

| ID | Scenario | Key medians |
|---|---|---|
| A1 | Cold `/sign-in`, Fast 3G | LCP 3 204 ms, 569 KB, JS 485 KB, 33 requests |
| A2 | Cold `/drive`, 25 files | LCP 4 976 ms, first row 5 543 ms, JS 680 KB |
| A3 | Warm `/drive` | LCP 516 ms, 4 KB from network |
| A4 | Nav drive→docs→sheets→calendar→drive | hops 130 / 74 / 37 / 147 ms |
| A5 | Shell re-render on route change | 0 frames > 100 ms |
| A6 | Shell JS at `/drive` | 2 835 KB shell JS, largest chunk 769 KB, TBT 128 ms |
| A7 | Rows after first page | 201 rows |
| B1 | Render 25 / 200 / 1 000 rows | 463 / 734 / 4 055 ms, growth 8.4× |
| B2 | Scroll 1 000 rows | 38 fps, 36 % dropped, max task 743 ms |
| B3 | Switch view on 1 000 rows | INP 1 080 ms |
| B4 | Sort / filter on 1 000 rows | 664 / 488 ms |
| B5 | Context menu on 1 000 rows | 894 ms, INP 328 ms |
| B6 | Thumbnail storm | 0 image requests in 2 s |
| C1 | Open doc 20 / 250 / 1 000 ¶ | 498 / 490 / 494 ms |
| C2 | Typing, 1 000 ¶ | INP 312 ms, TBT 10.2 s |
| C3 | Typing during autosave | max task 288 ms |
| C5 | Heading across 1 000 ¶ | failed in the full run; **12.4 s** run alone (Stage 0 triage) |
| C6 | Table insert / grow / undo | 837 / 3 014 / 3 433 ms |
| C7 | PDF export, 250 ¶ | 1 358 ms |
| C8 | Spell-check, 1 000 ¶ | TBT 4.7 s, max task 267 ms |
| D1 | Open 1 k / 10 k / 50 k cells | 365 / 346 / 343 ms |
| D2 | Scroll 50 k | 60 / 121 fps; longest frame 3 929 ms during load |
| D3 | Recalc | 452 ms |
| D4 | Paste 1 000 × 20 | 224 ms |
| D5 | Conditional format 50 k | 440 ms |
| D6 | Insert / delete row | 579 / 262 ms |
| D7 | Chart over 10 k | 1 520 ms |
| D8 | Header multi-select | INP 1 208 ms, 2 684 ms to settle |
| D9 | Autosave 50 k | 3 390 ms round trip, max task 347 ms |
| E1 | Open 60-slide deck | 352 ms |
| E2 | Slide navigation | INP 16 ms |
| E3 | Drag on 50-element slide | 67 fps |
| E4 | Drag in 200-node diagram | 60 fps |
| E4b | Konva drawing pan | failed in the full run (stale fixture); **open 304 ms, 62 fps** once fixed |
| E5 | Photos grid, 620 photos | first row 561 ms, 61 fps |
| E6 | Photo editor, 12 MP | 554 ms |
| E7 | Presenter view | 51 ms |
| F1 | Delivery audit | 0 uncompressed, 0 un-cached hashed assets |
| F2 | Bundle per route | sign-in 1 771 KB … sheets editor 2 798 KB; shared 4 325 KB |
| F3 | Heap over 20 navigations | +7 % |
| F4 | Open/close doc ×10 | −3 KB per cycle |
| F5 | Crypto 1 MB / 16 MB | block 0 / 208 ms |
| F6 | Search | first result 297 ms |
