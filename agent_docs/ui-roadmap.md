# UI roadmap — performance, look and feel, customization

**Status:** proposal, 2026-10-21. **Scope:** the web client (`web/`).

This is the single sequenced plan. The three area guides hold the evidence, the designs and the
reasoning; this document holds the **order**, and why that order:

| Area | Guide | Item IDs used below |
|---|---|---|
| Performance | [`ui-performance-roadmap.md`](ui-performance-roadmap.md) | `P0`–`P6` (findings), scenario IDs `A1`…`F6` |
| Look and feel | [`ui-look-and-feel-roadmap.md`](ui-look-and-feel-roadmap.md) | `LF0`–`LF6` (migration phases), the three looks |
| Customization | [`ui-customization-roadmap.md`](ui-customization-roadmap.md) | `U1`–`U13` (users), `T1`–`T6` (teams), §6 (org) |

Sizes are relative effort (S / M / L), not dates — they are for comparing items, not scheduling a
team that hasn't been sized.

---

## 1. How the order was decided

Five rules, each from a dependency the guides found. Everything in §3 follows from them.

1. **Measure before changing anything.** The perf suite can't attribute a slow frame to a line of
   code yet (no source maps), and C5 may be a 60-second freeze nobody has looked at. Every later
   performance item, and every "don't regress" gate, depends on this.
2. **Tokens before visuals, visuals before settings.** A density, type or shape setting only
   reaches components that read tokens; a restyle applied before the token migration is done twice.
   So: token contract → primitives → screens → the theme engine's extra dimensions.
3. **Fix a component's performance before restyling it.** The Drive list is replaced by a windowed
   one; the Docs and Sheets editors have per-keystroke and post-load costs in code the restyle will
   touch. Restyling first means restyling code that is about to be rewritten.
4. **Make room in the shell before adding to it.** Customization adds providers (preferences,
   commands, branding) and the redesign rebuilds the shell. Both go *after* the public routes are
   split off, or they land on `/sign-in` and undo the bundle work.
5. **Ship the redesign as a choice, flip the default last.** The three looks are a preference.
   They become selectable once the shell is done, and become the default only when the editors —
   where people spend their day — are done too, so nobody is defaulted into a half-migrated UI.

---

## 2. Rules that bind all three areas

Decisions one area forces on another. They apply from the stage where they first appear.

| Rule | Why | First applies |
|---|---|---|
| Windowed lists read row height from `--row-height` and re-measure when it changes | Density changes row height | Stage 1 |
| Appearance preferences apply synchronously from the boot cache; the server reconciles later | No fetch on the first-paint path | Stage 1 |
| New providers mount in the app shell, never in `app/layout.tsx` | Keeps `/sign-in` lean | Stage 2 |
| One command registry, one `keydown` listener | Palette, remapping and toolbars all read it; replaces 35 listeners | Stage 2 |
| No literal colours, sizes, radii, shadows or z-indexes outside `packages/tokens` | The looks and the theme engine only reach tokenised CSS | Stage 1 (warn) → Stage 6 (error) |
| `backdrop-filter` only on transient overlays, with an opaque fallback | Blur is a per-frame GPU cost | Stage 2 |
| Instance branding injected into the served HTML by the Rust server | Static export; no flash, no extra request | Stage 3 |
| No third-party requests on any route | Resilience on blocked networks; privacy | Stage 1 |
| Nothing a user, team or admin configures can carry code — tokens and declared values only | Safety in an E2EE product | Always |

---

## 3. The stages

Within a stage the three tracks run in parallel; a stage ends when all of its exit criteria hold.
**Every stage also ends with the perf suite's protected list green** (A4, A5, D1, E3–E5, F3, F4 —
performance guide §5), so no stage can quietly regress what already works.

### Stage 0 — Ground truth

*Nothing user-visible. Everything after depends on it.*

| Track | Item | Size |
|---|---|---|
| Performance | **P0** hidden source maps for perf builds, so slow frames resolve to `file:line` | S |
| Performance | **P0** triage C5 (a heading across a 1 000-paragraph doc: no result in 60 s) and E4b (Konva canvas re-created after mount?) | S |
| Performance | **P0** first committed baseline on the runner that will keep it; nightly in advisory mode (#196) | M |
| Look and feel | **LF0** dark mode for all three looks; compact and spacious densities; mock the remaining screens (Slides, Notes, Photos, Calendar, Diagrams, Drawing, Settings, sign-in, empty states) | L (design) |
| Customization | Write the preference registry's key list (every existing `localStorage` key, its type, scope and sync tier) — the spec stage 1 builds | S |

**Exit:** a slow frame in the suite names a source line; C5's cause is known (and fixed now if it is a
real hang); a baseline exists; all three looks are signed off in light and dark at three densities.

### Stage 1 — Foundations and certain wins

*Small visible improvement; the three foundations everything else stands on.*

| Track | Item | Size |
|---|---|---|
| Performance | **P1** window `FileGrid` (list, small and large grid), reading `--row-height`; move the context menu's state down; memoise the grid-item mapping | M |
| Performance | **P5** self-host Inter (variable woff2); editor fonts on demand; drop the Google Fonts links | S |
| Look and feel | **LF1** token contract: the new groups and the three looks' values in `packages/tokens`; `data-look`; `data-app` follows the route; lint rules in warn mode; remove hex fallbacks inside `var()` | M |
| Customization | **Phase 1** preferences foundation: registry, `user_preferences` + encrypted blob, boot cache read by the anti-FOUC script, socket sync, one-time migration of the legacy keys; theme gets one source of truth | L |
| Customization | **U12** AI provider and key move into the encrypted tier, out of plaintext `localStorage` | S |
| Customization | **U11** CF templates, gradient/fill presets and shape libraries move into the encrypted tier — they stop being lost on a new device | S |
| Customization | **U1** existing themes sync across devices; **U13** Settings generated from the registry and searchable | S |

**Why these together:** P1 is the worst measured interaction (a 1-second freeze switching Drive
views) with a confirmed mechanism and a local fix, and it has to exist before Drive is restyled.
P5 is small and removes a privacy leak and a failure mode on every page. The token contract and
the preference foundation are pure infrastructure and don't touch each other's files. U11/U12 are
cheap once the foundation exists and fix data loss and a plaintext secret.

**Exit:** B1 growth ≤ 2×, B2 < 10 % dropped frames, B3/B5 INP ≤ 200/100 ms; zero third-party
requests; tokens and lint baseline in place; no preference read outside `usePreference`; no secret
or user-authored content in `localStorage`.

**Status — built 2026-10-21 (`feature/ui-stage-1`).** Measured in real Chromium at 4× CPU against
the same 1 000-file folder: B2 38 → **60 fps, 0 % dropped**; B3 INP 1 080 → **112 ms** (the switch to
the small grid; the large-grid switch stayed near 700 ms — see Stage 4); B5 menu
894 → **122 ms** (INP 32 ms); B4 sort/filter 664/488 → 274/350 ms. **B1 is not met**: 4 055 →
3 132 ms, growth 8.4 → **4.9×** against a ≤ 2× target (the baseline's figures; an earlier 2 161 ms
came from a scroll helper that could stop at the first page) — what remains is five sequential page
fetches for 1 000 files against a debug server, not rendering, and is a pagination question for
Stage 2 rather than a windowing one. F1 measures **zero third-party requests**. The token groups,
`data-look`/`data-density`/route-following `data-app` and warn-only `pnpm lint:css` are in, with
**1 847 warnings** as the baseline and a computed-style snapshot of seven pages × two themes
unchanged. Every preference reads through the store; what remains in `localStorage` is the
device-only allowlist in `preference-registry.md` §3. An end-to-end run (real account, keyring and
server) migrated a pre-upgrade user's keys, sealed the AI key (no plaintext on the server or in the
browser), applied the theme before first paint, restored the key after reload and followed a change
in a second tab. Found on the way and fixed before shipping: the migration deleted a legacy key
before its save was confirmed, which a busy server turned into a lost AI key.

### Stage 2 — Make room

*The shell gets lighter, the command layer exists, the building blocks get their new look.*

| Track | Item | Size |
|---|---|---|
| Performance | **P4** split the public routes (`/sign-in`, `/register`, `/share`, `/self-host`) onto their own root; lazy-load the shell's heavy members and the export stacks; per-route size budgets enforced | L |
| Customization | **Phase 3** command registry; one `keydown` listener replacing 35; **U7** shortcut remapping and presets | M |
| Look and feel | **LF2** primitives in `@neutrino/ui` — buttons (rest/hover/primary per look), inputs, chips, menus, popovers, dialogs, toasts with the glass rules — token-only, all three looks in Storybook | M |
| Performance | Add the translucency scenario (a frosted menu open over a scrolling B2 list) before glass ships | S |

**Why now:** stage 3 rebuilds the shell and adds providers to it; doing the split first means both
land in the right place. The command registry has to exist before the new top bar (⌘K lives there)
and before any editor toolbar is redesigned (toolbars become command lists).

**Exit:** A1 sign-in LCP ≤ 1.5 s, A2 first Drive row ≤ 2.5 s, F2 `/sign-in` ≤ 600 KB raw, budgets
failing a PR that exceeds them; one `keydown` listener; every primitive renders in all three looks
with no literal visual values.

**Status — built 2026-10-21 (`feature/ui-stage-1`, PR #266).** Measured at Fast 3G and 4× CPU
against the baseline committed at the start of the stage:

- **P4.** Three root layouts — `(public)` (landing, sign-in, register, self-host, share),
  `(apps)`, `(mirror)` — with a standalone 404. libsodium (the 769 KB A6 chunk) loads inside
  `initSodium()` instead of with every page; `@neutrino/ui`/`@neutrino/layout` imports are
  tree-shaken; the document preview (which carried part of every editor), the zip viewer and
  recharts load on first use. Raw first-load JS: `/sign-in` 1 803 → **546 KB**, `/drive`
  2 363 → 1 174 KB, the Sheets editor 1 998 → 1 498 KB. **A1 LCP 3.26 → 1.32 s** (met); **F2
  sign-in ≤ 600 KB** (met). **A2 first Drive row 5.57 → 3.54 s — not met** against 2.5 s: what
  remains is ≈ 350 KB of compressed shell JS at Fast 3G and the folder listing waiting for
  `auth/me`; fewer, larger chunks made no difference (measured). The next steps are framer-motion
  out of the primitives and the listing fetched beside the auth check, both in Stage 3's shell.
  `scripts/check-route-budgets.mjs` runs after every build and fails it when a route passes
  `route-budgets.json` — it caught a regression the first day (a client component shared between
  two roots pulls the other root's chunks onto every page that uses it; the public root now has
  its own).
- **Command registry.** `@neutrino/commands`: a catalog of 68 commands, one dispatcher on
  `window` (keydown capture and bubble, keyup — three listeners, one module), Escape as a stack
  of dismiss layers so it closes only the topmost thing, and Settings › Keyboard with presets
  (Neutrino, Google Workspace, Microsoft 365), recording, conflict prompts and search. All ~55
  listeners moved; a test fails on any new one. Found on the way: Docs saved twice per ⌘S.
- **LF2.** Every primitive draws from look tokens; *Looks/All primitives* in Storybook shows them
  in all three looks, light and dark; classic's computed styles are unchanged (330 snapshots).
  Drive's row menu is on the glass tokens too — in the legacy `light-glass` theme that makes it
  as opaque as every other menu there (overlay rather than surface colour).
- **Translucency.** B7 scrolls the 1 000-row list under a frosted menu: 60.5 fps, 0 % dropped
  (B2 without the menu: 60.1 fps). The frame metric is main-thread cadence in headless Chromium;
  compositor cost on weaker GPUs is not captured, so B7 is worth re-running on real hardware
  before glass ships.

### Stage 3 — The new shell, as an opt-in

*Users can switch to Light Flow, Quiet Precision or Blended Flow.*

| Track | Item | Size |
|---|---|---|
| Look and feel | **LF3** new top bar (search = ⌘K, encryption pill), sidebar with **Apps** under the Drive views, editor frame (title bar, save state, presence, Share); the stacked logo row and top bar removed | L |
| Customization | **U4** `appearance.look` selectable in Settings; **U6** the command palette surface | S |
| Customization | **Phase 4** org and team layer: `org_`/`team_preferences`, locks; §6.1 branding injected by the Rust server; §6.2 org defaults and locks (look, density, AI provider, fonts); §6.3 apps enabled per instance; **T1** team accent and icon; **T2** team default views | L |

The current look stays the default. "Try the new look" is a Settings choice — and an org default
an admin can set for everyone who wants it early.

**Exit:** every route renders in the new shell in all three looks; an admin can brand the instance
with no flash on `/sign-in`, set and lock a default, and hide apps; the palette runs any registered
command.

**Status — built 2026-10-22 (`feature/ui-stage-1`, PR #266).** All three exit criteria hold,
checked end to end (`e2e/tests/cross-cutting/shell-and-organisation.spec.ts`).

- **Shell (LF3).** `@neutrino/layout` gains `ShellTopBar` (brand, a search field that opens the
  palette, the encryption pill, notifications, account), `ShellSidebar` (New, Drive views, Apps,
  the user's teams in their colours, tags, admin, storage, collapse to a rail) and
  `AppShell variant="flow"`; every route renders in it in the three new looks, from tokens only.
  Editors get the editor frame: no top bar, the brand and collapse control at the top of the
  sidebar, search, notifications and account at its foot. The editors' own title bars and toolbars
  are untouched until stage 5. Classic keeps today's shell: 330 computed-style snapshots of the
  primitives, 0 differences from stage 2. The shell renders on hydration rather than in the static
  prerender — prerendering the classic one flashed it in front of anyone on a new look.
- **Look (U4)** in Settings › Appearance, each option a live miniature in its own tokens; **palette
  (U6)** on ⌘K (and ⌘/, which Docs leaves free — Docs keeps ⌘K for links, as Google Docs does), in
  both shells, listing whatever the screen underneath has registered plus navigation, and searching
  files. Commands gained `yields` and `palette: false` in the catalog; the dispatcher gained
  `availableCommands` and `runCommandById`, and now runs one command per key press across its two
  phases.
- **Org and team layer (Phase 4)** — customization roadmap §6.5: org defaults and locks, the apps
  list, branding written into every page by the server (no flash: the org layer and the brand are in
  the HTML before any script), T1 team colour and tint, T2 team defaults for view, order and
  density. Found on the way: team colours were stored unchecked and drawn into every member's page;
  now `#rrggbb` only. The service worker served cached pages until the next deploy, which would have
  hidden brand and org changes; pages are now network-first.
- **A2 levers.** framer-motion is gone from `@neutrino/ui` and `@neutrino/layout` (CSS keyframes and
  `usePresence`), and the Drive listing starts from the user id in the access token instead of
  after `/auth/me`. `/drive` first-load JS 1 174 → **1 082 KB** with the new shell included. **A2
  is still not met: first row 3.54 → 3.02 s, LCP 3.08 → 2.79 s** against ≤ 2.5 s. A waterfall shows
  the listing no longer waits for auth; what remains is the JavaScript itself (≈ 2.2 s at Fast 3G
  before the first script runs) and ≈ 300 ms of rendering before the listing request. Also seen:
  `/auth/me`, `/preferences` and the search-index meta are each requested twice, and a 5 KB chunk of
  the `(mirror)` root's layout loads on `/drive`. Carried to stage 4.
- Browser suite: 543 of 544 against a local server (the one failure reads the Docker stack's storage
  directory, as before). A1 unchanged at 1.33 s.

### Stage 4 — Drive and the listings

*The most-used screen, on its new list, in its new look, with its first settings.*

| Track | Item | Size |
|---|---|---|
| Look and feel | **LF4** restyle Drive on the windowed `FileGrid`: Quick access as its own section above My Drive, the new row design; the `DocumentLibrary` pages; fold the hand-written Notes, Diagrams and Photos landing pages into `FileGrid` while restyling them | M |
| Customization | **Phase 5, first slice** theme engine v2 on the migrated screens: **U2** density and text size, **U3** accent picker with contrast guarantee, **U5** reduce motion / transparency, higher contrast | M |
| Customization | **Phase 6, first slice** **U8** sidebar pin/reorder/hide, **U9** default views per listing | M |

**Why density here and not earlier:** this is the first point at which a whole screen — shell plus
Drive — reads only tokens, so the setting visibly works instead of half-working.

**Exit:** Drive matches the mockups in all three looks and three densities; B-section targets still
met at every density; sidebar and default views sync across devices.

**Status — built 2026-10-22 (`feature/ui-stage-1`, PR #266).**

- **Drive and the listings (LF4).** A listing token group drives `FileGrid` (rows, cards, chips,
  view and sort controls, file colours); classic's values are what it drew before — a page-level
  snapshot of Drive (grid and list), Recent, Docs, Settings, Calendar, Photos and both editors,
  light and dark, 27 properties per element, is identical to stage 3. In the new looks Drive is two
  regions on the ground: Quick access (the four files last edited, as preview cards) and Files
  (the folder as the title, controls, chips, and a list `--row-height` tall at each density). Every
  `DocumentLibrary` page is one region; Diagrams moved onto `DocumentLibrary` (its `/diagrams`
  budget raised to the other libraries', 970 → 1 140 KB). Not built: the Owner column (the listing
  has no owner, and in My Drive it is always you), friendly dates in the list. Photos stays its own
  timeline — it is not a file listing.
- **Theme engine, first slice:** density and text size (U2), any accent drawn at 4.5:1 in light
  and dark and stored as picked (U3), reduce motion, reduce transparency and higher contrast (U5) —
  Settings › Appearance, applied before first paint.
- **Layout as data, first slice:** pinned folders, hidden entries and sections, the apps' order
  (U8, `shell.sidebar`); each listing remembers its view and sort, and Drive's landing page (U9,
  `listing.views`, `drive.landing`) — synced, checked from a second browser
  (`e2e/tests/drive/drive-new-looks.spec.ts`).
- **B section at every density** (Light Flow, list — the new looks' default — 1 000 rows, 4× CPU):
  B1 1.10 / 1.10 / 1.10 s with growth 2.5 / 2.0 / 2.2× (compact / comfortable / spacious), B2
  60 fps with nothing dropped, B4 INP 40 ms, B5 16–32 ms. Two findings on the way:
  - **B1 had been timing its own scroll helper.** It brought the last *rendered* row into view, which
    advances only by the window's overscan — four rows in the list, so six times as many passes as
    the large grid. The helper now jumps its scroller to the end. Classic's large grid with the
    corrected helper: 1.7 s, growth 3.5× (over the 3× budget; the list meets it).
  - **B3 (view switch) was 650–700 ms in every look, and in the committed baseline** (switch to the
    large grid 701 ms) — Stage 1's 112 ms was the switch to the small grid. A profile put a third of
    it in date formatting (`toLocaleDateString` builds a formatter per call; now cached in
    `@neutrino/utils`): **648 → 344 ms**. The rest is the style and layout of the new view, forced by
    the window's measurement. Still over 200 ms; carried to the performance track.
- Also: one `/auth/me` per page load instead of two (concurrent profile reads share a request).

### Stage 5 — The editors, one at a time

*For each editor: fix its performance, restyle its chrome, then make its toolbar customizable.*

Start with the shared worker, which two editors need:

| Item | Size |
|---|---|
| **P6** one dedicated worker for libsodium, serialise-and-encrypt autosave, and spell-check | M |

Then, per editor, in this order (most-used and worst-measured first):

| Editor | Performance first | Then look and feel | Then customization | Size |
|---|---|---|---|---|
| **Docs** | **P2**, driven by the stage-0 trace: incremental plugin state, deferred whole-document derivations, spell-check in the worker; C6 table/undo | **LF5** chrome, toolbar, margin comments, status bar | **U10** toolbar pin/hide/reorder | L |
| **Sheets** | **P3**: the ~4 s post-load style/layout frame; header selection as ranges; chart downsampling; autosave in the worker | **LF5** chrome, formula bar, grid, tabs | **U10** | L |
| **Slides** | Protected-list check only (E1–E3, E7 are healthy) | **LF5** | **U10** | M |
| **Diagrams** | Protected-list check only (E4 healthy) | **LF5** | **U10** | M |
| **Drawing** | E4b's finding from stage 0 | **LF5** | **U10** | M |

**When Docs and Sheets are both done, flip the default** to the new look (org admins who locked the
old one keep it until they change their lock).

**Exit:** C2 typing INP ≤ 100 ms, C6 ≤ 300 ms, C8 no task > 50 ms; D2 no frame > 200 ms during load,
D8 INP ≤ 200 ms, D7 ≤ 500 ms; F5/D9 longest task ≤ 50 ms; every editor in all three looks with
lint debt at zero for its files.

**Status — built 2026-10-22 (`feature/ui-stage-1`, PR #266).** Every editor is restyled in all
three looks and its lint debt is at zero; Classic is pixel-identical. Five of the nine performance
targets are met; four are better but not met. The default look stays **Classic**, by decision: the
new looks are an addition, not a replacement.

| Target | Before | Now | |
|---|---|---|---|
| C2 typing INP, 1 000 paragraphs | 312 ms | **48 ms** (80–136 ms under heavy machine load) | met |
| C6 grow table / undo | 3 835 / 3 942 ms | **1 213 / 655 ms** (wall time of five and eight clicks); INP 192 ms | not met |
| C8 longest task during spell-check | 359 ms | **50–62 ms** | not met |
| D2 longest frame while the L sheet loads | 3 929 ms (9.6 s at load ~20) | **177–181 ms** | met |
| D8 header multi-select INP | 1 208 ms | **32 ms** | met |
| D7 chart over a large range | 1 520 ms (1.8 s) | **654 ms** (suite budget 800) | not met (500) |
| F5 longest block while a 16 MB upload is sealed | 208 ms | **0** (in the worker) | met |
| D9 longest task during an L-sheet autosave | 347 ms | **61–64 ms** (suite budget 150) | not met (50) |
| D3 in-app recalc | 307 ms | **64 ms** | — |

What did it, in the order it was found (each from a CPU profile or a Chrome trace at 4× CPU):

- **Docs (P2).** Spell- and grammar-check rebuilt their decorations over the whole document on every
  keystroke; now only the paragraphs a change touched (`lib/extensions/incrementalDecorations.ts`).
  Changes are found by comparing documents, because y-prosemirror applies an undo as one step
  replacing the whole document. Grammar does nothing while off. Pagination re-measures once
  typing settles, reading rects only for replaced blocks. The editor re-renders after paint (and
  only after typing pauses), and the document is serialised when the save runs, not per keystroke.
  The largest single cost was Chrome's own: every caret move walks the editable root to find the
  caret's offset, and 9 000 misspelling spans made that walk five times longer. Misspellings are now
  drawn only within a screen of the viewport, so the editor has 1 600 elements instead of 10 700.
- **Sheets (P3).** Opening a workbook read every cell and evaluated every formula in one task, after
  round-tripping the model through JSON; now in slices (`lib/yieldToMain.ts`). Selecting header rows
  built two Sets of a million ids; selections are now shaped `CellSet`s that answer from their
  rectangle or indices. The xlsx writer is sliced, and the search index reads the model it already
  has. Charts draw at most 200 points or 400 bars (LTTB for curves, the peak of each run for bars).
- **The editor worker (P6).** One worker seals uploads and autosaves (same cipher and output;
  `api-drive` takes a pluggable sealer and falls back to the page) and runs spell-check. The
  dictionary is no longer built on the page when an editor opens; checks answer from a verdict cache
  fed in batches.
- **Look (LF5).** An `--editor-…` token group in `tokens/looks.css`, defined for the new looks only.
  It gives the frame's title bar the app-coloured icon and "Saved and encrypted · just now", a
  floating toolbar (Precision), a soft one (Light Flow) or a glass one (Blended), and quiet status bars
  and panels. Sheets gets the toolbar above a field-like formula bar, a mono name box and the running
  Sum of the selection. Docs gets page count and language in its status bar.
- **Customization (U10).** Toolbars are ordered lists of tool groups (`lib/editorToolbars.ts`,
  `editor.toolbars`): reorder, hide into "More tools", and captions on or off. Customize from a
  right-click on any toolbar or from Settings › Appearance › Toolbars.

Not met, and why. C6's remaining time is mostly first-use warm-up plus React commits per click;
warm, a row is 41–135 ms. C8 and D9 sit just over 50 ms: one decoration window build and one
writer slice plus jszip's chunking. D7 is recharts' per-bar cost at 400 bars. All four are carried
to the performance track. Browser suite: 555/557. The failures are the Docker storage-path test,
and the search page tests' index being cleared under load — partly fixed: they now turn search
sync off where the app reads it.

### Stage 6 — Everything else, teams, and lock it in

| Track | Item | Size |
|---|---|---|
| Look and feel | **LF6** Photos, Calendar, Notes, Settings, admin, sign-in, dialogs and empty states; lint rules to **error** | L |
| Customization | **Phase 7** **T3** team template galleries, **T4** team libraries sealed to members, **T5** pinned resources, **T6** team command presets | M |
| Customization | **Phase 5 completes** type (UI font from the instance library) and shape settings on every screen | S |
| Performance | **Enforce**: `PERF_ENFORCE=1` on the protected list and on every target this roadmap met | S |

**Exit:** no hard-coded visual value anywhere outside `packages/tokens`; every customization
setting reaches every screen; a PR that regresses a budget or adds a literal colour fails CI.

**Status — built 2026-10-22 (`feature/ui-stage-6`).** Classic stays the default look and is
unchanged: computed styles of 19 routes in light and dark, 19 427 elements, are identical to Stage 5
apart from a 0.02 px rounding.

- **No literals outside the tokens.** 807 literal colours, 819 px font sizes and 111 numeric
  z-indexes moved into `packages/tokens`, each with its exact value:
  - colours: a neutral token where one matches, otherwise `palette.css`, named by hue and lightness;
  - font sizes: the rem scale, or rem steps equal to the old px at the default text size — so the
    text-size setting now reaches all of them;
  - z-indexes: the layer scale, or named layers.

  212 inline-style colours went the same way. Colours that are data (a sheet's border weights,
  shape defaults, chart palettes) stay literal on purpose: they reach canvases and saved files,
  where `var()` means nothing.

  Enforced in CI by a new `Web checks` workflow on every PR:
  - Stylelint at error;
  - an ESLint rule against literal colours in `style` props and `CSSProperties` objects;
  - `lint:colours`, the same check for the packages.
- **LF6.** A `--screen-…` token group, new looks only, gives the remaining screens the looks'
  primary actions (accent text on a ring in the flows, filled in Precision) and selection tint, and
  the sign-in page its ground and glass card. Covered: Settings, admin, profile, Calendar, Drive's
  upload panel, the Save As and comments dialogs, the public pages. Photos and Notes already read
  the primitives' tokens.
- **Theme engine, last two dimensions.**
  - **Shape** (`appearance.shape`): every radius reads `--radius-scale` — the token scale, the
    looks' own, 502 component radii in CSS and 69 set inline in TSX. Sharper halves them; Rounder
    makes them 1.75×.
  - **Interface font** (`appearance.font`): a built-in or one from the instance's font library
    becomes `--font-sans`.

  Both are set by user, team or organisation and applied before first paint.
- **Teams (T3–T6).**
  - T3: a Templates view in each space lists the team's .dotx/.xltx/.potx; a Docs template makes
    a new document.
  - T4: "Share my library with the team" publishes gradient presets, conditional-format
    templates and Diagrams shape libraries as an encrypted team file, sealed to members by
    `handFileKeyToTeam`. Members see them read-only in the fill pickers, the conditional-format
    dialog and the Diagrams shape panel.
  - T5: pins (folders, files, links) at the top of the space and under the team in the sidebar.
  - T6: palette shortcuts that make a document from a team template.

  Pins and shortcuts are team defaults (`team.pins`, `team.commands`); the library is named by
  `team.library`.
- **Key requests for late joiners.** A file's key is sealed to the members there when it is added,
  so someone who joins later sees the file and cannot open it. The listings now mark such a file
  (`keyMissing`), and clicking it asks for the key, with an optional message
  (`POST /drive/teams/{id}/key-requests`, migration 00146). The team's Owners and Admins, and the
  file's owner, are notified and see the request above the team's Files. Approving seals the key to
  the requester in the approver's browser first (`lib/teamKeyRequests.ts`) — the server refuses an
  approval until the requester holds a key — and denying takes an optional reason. The requester
  is notified either way, with the reason. A requester whose public key changed since it was
  pinned is not sealed to; the approver is sent to the file's Share dialog to compare
  fingerprints. Team uploads now hand the key to the current members as well, which they did not
  before.
- **Slides saves in order.** Saves of one deck are queued, and each takes the version the previous
  one returned. A rename straight after creating a deck no longer races the first autosave into a
  409 that left Back stuck.
- **Performance, enforced.** `e2e/perf/enforced.ts` names the protected list and every target met.
  `PERF_ENFORCE=1` fails a run on those and leaves the rest advisory. D2's "no frame over 200 ms
  while loading" is now a budget. A nightly `Performance` workflow runs the suite on a pinned
  runner, with a dispatch option to record that runner's baseline first.

**Not done, and why.**
- **Perf on every PR.** The exit criterion says a PR that regresses a budget fails CI. The suite
  needs the Docker stack and an hour, so it runs nightly, not per PR, and judges only absolute
  budgets until the runner has its own baseline.
- **Table styles in the team library.** There is no personal table-style library to share yet.
- **Search tests.** The browser suite's search tests still lose their seeded index now and then
  under load, even with sync off.

Tests: browser suite 560/562 — the Docker storage-path test and that Slides race. New:
`team-sharing.spec.ts` 3/3, `shape-and-font.spec.ts` 2/2. `vitest`: 3 828 web tests pass, plus
the same 4 `api-drive` failures as before. Stylelint, `lint:colours` and ESLint are clean.

---

## 4. At a glance

```
Stage 0  Ground truth        P0 instrument · LF0 sign-off (dark, densities, screens) · preference key spec
   │
Stage 1  Foundations         P1 Drive windowing · P5 fonts · LF1 tokens · Prefs foundation · U11 U12 U1 U13
   │
Stage 2  Make room           P4 shell split · command registry + U7 · LF2 primitives · glass scenario
   │
Stage 3  New shell (opt-in)  LF3 shell · U4 look choice · U6 palette · org/team layer · T1 T2
   │
Stage 4  Drive               LF4 Drive restyle · U2 U3 U5 theme engine · U8 U9 layout
   │
Stage 5  Editors             P6 worker → Docs (P2 → LF5 → U10) → Sheets (P3 → LF5 → U10)
   │                         → Slides → Diagrams → Drawing      ▸ flip the default look
Stage 6  Finish & enforce    LF6 remaining screens · T3–T6 team libraries · lint + budgets enforced
```

## 5. What the first stage-pair buys

If the work stopped after stages 0 and 1, users would already have: Drive that stays smooth at any
folder size, pages that no longer contact Google or stall when it is unreachable, their themes and
AI settings on every device, libraries that survive a new laptop, and an API key that is no longer
in plaintext browser storage — and the codebase would have the attribution, tokens and preference
layer every later stage is built on.
