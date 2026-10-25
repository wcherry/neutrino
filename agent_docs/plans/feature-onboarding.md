# Plan: Onboarding phase 1 — guided-tour framework and the Drive tour

Branch `feature/onboarding`, stacked on `feature/editor-shell-and-quick-access` (#281), which added
the top-bar Search button, the Quick access menu and Drive's Quick access row the tour points at.

## Summary

A reusable, one-time guided tour: a spotlight over a real element and a card beside it ("N of M",
the tour's name, title, body, Skip tour / Back / Next / Done). Each app gets one tour; phase 1 ships
the framework and the six-step Drive tour. Phase 2 adds Docs, Sheets, Slides, Notes, Photos,
Calendar, Diagrams and Drawings without touching the framework or the server catalog.

## Affected repos

`neutrino` only — web plus the server's preference catalog. No client app reads the new key.

## Design

- **Tours** (`web/apps/web/src/components/Tour/`): a `TourDefinition` is an id, a name, the routes
  it auto-starts on, and ordered steps. A step names its target by a `data-tour="…"` attribute on the
  real element, plus title, body and an optional placement.
- **Skipping:** when a tour starts, each step's target is looked up and kept only when it is rendered,
  non-empty and horizontally on screen (a collapsed sidebar, a phone-width drawer and a hidden panel
  all drop out). M counts only those. A tour with no visible step does not start.
- **Seen:** `onboarding.toursSeen`, a synced `set` preference (options: every tour id, so phase 2
  needs no catalog change), user scope, plain tier, default `[]`. Written on Done and on Skip.
- **Auto-start:** once per tour, when the user is on a route the tour names, after preferences have
  loaded from the server, the E2EE gate has settled (it now publishes whether it is showing), and no
  other modal is open. Never on a pref that is still the default.
- **Replay:** there is no Help menu in the shell, so "Take the Drive tour" goes in the account menu
  of both shells (classic `Topbar` user menu, the new looks' `AccountMenu`, which the editors' title
  bars reuse), and a `shell.takeTour` command in the palette. Replay ignores the seen pref.
- **e2e:** Playwright sets `navigator.webdriver`; auto-start is off under it unless
  `localStorage['neutrino.tours.autoStart'] === 'on'`. No existing spec changes. The tour spec opts
  in with an init script. Replay is never suppressed.

## Tasks

1. Registry + catalog + tests: `onboarding.toursSeen`.
2. `data-tour` targets: New (`NewItemFAB`), Quick access, filter chips and view toggle (`FileGrid`),
   top-right group (both top bars), storage meter (both sidebars).
3. Tour framework: overlay, provider, auto-start, visibility rules, keyboard, CSS module on tokens.
4. Drive tour definition; shell integration (provider, account menu entry, palette command).
5. Vitest suites; Playwright spec `e2e/tests/onboarding/drive-tour.spec.ts`.

## Test plan

- Vitest: step skipping and renumbering, Back/Next/Skip/Done, Esc, arrow keys, seen written on
  finish and skip, no auto-start when seen or before prefs load or behind a modal, replay ignores seen.
- `cargo test preferences::catalog`.
- Playwright: fresh user sees the tour after the encryption gate, walks it, skip, no reappearance
  after reload, replay from the account menu.

## Risks

- A tour overlay over existing e2e specs: handled by the webdriver rule above.
- Targets inside the off-canvas sidebar at phone width: skipped by the horizontal on-screen check.

## Feature flag

None. The tour is behind existing UI and is removed by reverting the commit.
