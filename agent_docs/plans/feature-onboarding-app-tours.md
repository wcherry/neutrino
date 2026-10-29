# Plan: Onboarding phase 2 — guided tours for the other eight apps

Branch `feature/onboarding-app-tours`, stacked on `feature/onboarding` (#282), which added the tour
framework (`web/apps/web/src/components/Tour/`) and the Drive tour.

## Summary

One tour each for Docs, Sheets, Slides, Notes, Photos, Calendar, Diagrams and Drawings, on the
phase 1 framework. Each starts by itself the first time its app is opened, and replays from "Take
the <App> tour" in the account menu (every look, the classic top bar and the editors' title bars)
and from the palette's `shell.takeTour`. No catalog change: `onboarding.toursSeen` already lists
every app id.

## Affected repos

`neutrino` only, web only.

## Where each tour starts

- **The document apps (Docs, Sheets, Slides, Notes, Diagrams, Drawings): the editor**, on the first
  document opened. Everything the tours describe is in the editor, and the libraries show none of it.
- **Photos: `/photos`** (the library is the app). **Calendar: `/calendar`.**

## Framework changes (small, general; the Drive tour is unchanged)

1. **`home` is optional.** An editor's tour runs on whichever document is open, so there is nowhere
   to send a replay from elsewhere. A tour without a home is offered ("Take the … tour", the palette
   command) only on the routes it starts on: in the editor, not in the library. `tourOffered()`.
2. **`waitFor`.** An editor draws after it opens (it decrypts first). A tour names a target that
   means "drawn"; until it is on screen the tour waits without spending the ten tries a tour with
   nothing on screen gets (up to `MAX_WAIT_TRIES` × 400 ms = 30 s, then it gives up unmarked).
3. **`display: contents` targets** are measured as the box around their children (`targetRect`):
   a toolbar's tool wrapper, and a group of tabs marked for one step.
4. **Shared components can carry a target:** `RailPanel.tour` (the rail tab), `ToolDef.tour`
   (a toolbar group), and a `data-tour` prop on `ShareButton`, `Toolbar` and `HamburgerMenu`.
   The palette's Search button carries `search` in both shells.

## Steps dropped or changed

- **Slides, Present:** the presenter view has notes and the next slide but **no timer**, so the step
  says notes and next slide.
- **Calendar, New event:** there is no natural-language entry for events. Smart Add exists for
  **tasks**, so the example ("Lunch with Grace ^fri 1pm") moved to the Tasks step.
- **Notes:** "/" and "checklists tick off in place" share one step; links and backlinks are the next
  step on the same editor. The backlinks list only exists when another note links here, so it has
  no target of its own.
- **Photos, open a photo:** points at the first photo, so a new, empty library leaves it out.

## Test plan

- Vitest `apps/web/src/__tests__/tour/appTours.test.tsx`: each tour's targets, routes, home and
  `waitFor`; every target is carried by something in the source; every step shows when its targets
  are on screen; `waitFor` waits past ten tries and gives up after `MAX_WAIT_TRIES`; a homeless
  tour is offered and replays only where it runs; `display: contents` measurement and spotlight;
  the shared components' tour props.
- Playwright `e2e/tests/onboarding/app-tours.spec.ts`: per app, auto-start, walk every step, Done
  is recorded, no reappearance after reload, replay from the account menu; replay from an editor's
  title bar in Blended (and not offered in the Docs library); replay from the Photos map goes to
  `/photos`; replay from the palette.
- Full e2e run; tsc, lint, stylelint, inline-colour check.

## Feature flag

None, as in phase 1.
