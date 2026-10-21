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

### Stage 6 — Everything else, teams, and lock it in

| Track | Item | Size |
|---|---|---|
| Look and feel | **LF6** Photos, Calendar, Notes, Settings, admin, sign-in, dialogs and empty states; lint rules to **error** | L |
| Customization | **Phase 7** **T3** team template galleries, **T4** team libraries sealed to members, **T5** pinned resources, **T6** team command presets | M |
| Customization | **Phase 5 completes** type (UI font from the instance library) and shape settings on every screen | S |
| Performance | **Enforce**: `PERF_ENFORCE=1` on the protected list and on every target this roadmap met | S |

**Exit:** no hard-coded visual value anywhere outside `packages/tokens`; every customization
setting reaches every screen; a PR that regresses a budget or adds a literal colour fails CI.

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
