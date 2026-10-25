'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { preferences as defaultStore, usePreference, type PreferenceStore } from '@neutrino/preferences';
import { appForPath } from '@/lib/appForPath';
import { TourOverlay } from './TourOverlay';
import { otherModalOpen, resolveSteps } from './targets';
import { findTarget } from './targets';
import { TOURS, tourForApp, tourOffered } from './tours';
import type { ResolvedStep, TourDefinition, TourId } from './types';

/**
 * Device-local override of when tours start on their own: `on` always, `off` never, anything else
 * the default, which is "except under browser automation" (`navigator.webdriver`). Playwright sets
 * that flag, so no end-to-end spec gets a tour over the page it is testing unless it asks for one by
 * setting this key to `on` before the app loads. Replay from the menu is never suppressed.
 */
export const AUTO_START_KEY = 'neutrino.tours.autoStart';

export function autoStartAllowed(): boolean {
  let override: string | null = null;
  try {
    override = window.localStorage.getItem(AUTO_START_KEY);
  } catch {
    // No storage: fall through to the default.
  }
  if (override === 'on') return true;
  if (override === 'off') return false;
  return !(typeof navigator !== 'undefined' && navigator.webdriver);
}

/** How long the page is left to settle before a tour looks for its targets, and between tries. */
export const SETTLE_MS = 400;
/** Tries before giving up on a tour none of whose targets are on screen (a phone, say). */
const MAX_TRIES = 10;
/** How long, in tries, a tour waits for its `waitFor` target — an editor still opening — at most. */
export const MAX_WAIT_TRIES = 75;

export interface TourControllerOptions {
  pathname: string;
  /** Signed in, and this user's preferences have come from the server — "seen" is their real value. */
  ready: boolean;
  /** Something a tour must not open over is still deciding or showing (the encryption gate). */
  blocked: boolean;
  /** Goes to a tour's home route when it is replayed from somewhere it cannot run. */
  navigate?: (href: string) => void;
  tours?: readonly TourDefinition[];
  store?: PreferenceStore;
}

export interface TourControls {
  /** The tour for the app on screen, if it has one — what "Take the … tour" replays. */
  available: TourDefinition | null;
  /** Replays a tour (the current app's by default), whether or not it has been seen. */
  start: (id?: TourId) => void;
  activeId: TourId | null;
}

export interface TourController extends TourControls {
  /** The same three, as one object that changes only when they do — for `TourControlsProvider`. */
  controls: TourControls;
  /** The overlay while a tour runs; render it once, anywhere in the shell. */
  overlay: React.ReactNode;
}

/**
 * Runs the guided tours: starts the current app's on its own the first time, once nothing is in
 * the way, and replays one on request.
 *
 * "The first time" is `onboarding.toursSeen`, a synced preference, so finishing or skipping a tour
 * on one device keeps it from starting on another. It is only read once the user's own values have
 * arrived (`ready`), never on the empty default a fresh browser starts with. A tour that starts and
 * is abandoned by a reload is not marked, and starts again: only Done and Skip tour count.
 */
export function useTourController({
  pathname,
  ready,
  blocked,
  navigate,
  tours = TOURS,
  store = defaultStore,
}: TourControllerOptions): TourController {
  const [seen] = usePreference('onboarding.toursSeen', store);
  const [active, setActive] = useState<{ tour: TourDefinition; steps: ResolvedStep[]; run: number } | null>(null);
  const [replay, setReplay] = useState<TourId | null>(null);
  // Tours already started (or given up on) by themselves in this session: never twice.
  const autoTried = useRef(new Set<TourId>());
  // Whether the pending replay had to go to the tour's home route first.
  const replayNavigated = useRef(false);
  const runs = useRef(0);

  const appTour = tourForApp(appForPath(pathname), tours);
  const available = appTour && tourOffered(appTour, pathname) ? appTour : null;

  useEffect(() => {
    if (active) return;
    let tour: TourDefinition | null;
    const isReplay = replay !== null;
    if (isReplay) {
      tour = tours.find((t) => t.id === replay) ?? null;
      if (!tour) {
        setReplay(null);
        return;
      }
      // Replayed from elsewhere: `start` has sent the user to its home route; wait to get there.
      if (!tour.startsOn(pathname)) return;
    } else {
      tour = available;
      if (!ready || blocked || !tour || !tour.startsOn(pathname)) return;
      if (seen.includes(tour.id) || autoTried.current.has(tour.id) || !autoStartAllowed()) return;
    }
    const chosen = tour;
    // A replay on the page it runs on starts at once: that page has long since drawn. Anything
    // else — the first visit, or a replay that had to navigate — waits for the page to stop
    // growing, so a step is not left out only because its part of the page had not rendered yet.
    const immediate = isReplay && !replayNavigated.current;
    let tries = 0;
    let waited = 0;
    let previous = -1;
    let timer: ReturnType<typeof setTimeout>;
    const settle = (steps: ResolvedStep[]) => {
      if (isReplay) setReplay(null);
      else autoTried.current.add(chosen.id);
      replayNavigated.current = false;
      if (steps.length > 0) setActive({ tour: chosen, steps, run: ++runs.current });
    };
    const attempt = () => {
      // Another dialog opened first (an upload, a share): wait for it rather than cover it.
      if (!isReplay && otherModalOpen()) {
        timer = setTimeout(attempt, SETTLE_MS);
        return;
      }
      // The page has not drawn yet (an editor decrypting its document): wait, and do not count it.
      // Never drawn (it failed to open, say): that is not the page the tour is about, so give up.
      if (chosen.waitFor && !findTarget(chosen.waitFor)) {
        if (++waited >= MAX_WAIT_TRIES) settle([]);
        else timer = setTimeout(attempt, SETTLE_MS);
        return;
      }
      const steps = resolveSteps(chosen.steps);
      const stable = immediate || steps.length === previous;
      previous = steps.length;
      if ((steps.length > 0 && stable) || ++tries >= MAX_TRIES) settle(steps);
      else timer = setTimeout(attempt, SETTLE_MS);
    };
    timer = setTimeout(attempt, immediate ? 0 : SETTLE_MS);
    return () => clearTimeout(timer);
  }, [active, replay, ready, blocked, available, pathname, seen, tours]);

  // Leaving the route a tour runs on (the browser's Back) ends it, unmarked.
  useEffect(() => {
    if (active && !active.tour.startsOn(pathname)) setActive(null);
  }, [active, pathname]);

  // Read through a ref so `start` keeps one identity across renders (the palette registers it).
  const live = useRef({ active, pathname, navigate });
  live.current = { active, pathname, navigate };
  const start = useCallback(
    (id?: TourId) => {
      const tour = id ? tours.find((t) => t.id === id) : available;
      if (!tour || live.current.active) return;
      replayNavigated.current = !tour.startsOn(live.current.pathname);
      if (replayNavigated.current) {
        // An editor's tour has nowhere to go: it runs on whichever document is open.
        if (tour.home === undefined) return;
        live.current.navigate?.(tour.home);
      }
      setReplay(tour.id);
    },
    [tours, available],
  );

  const end = useCallback(
    (tour: TourDefinition) => {
      const current = store.get('onboarding.toursSeen');
      if (!current.includes(tour.id)) store.set('onboarding.toursSeen', [...current, tour.id]);
      setActive(null);
    },
    [store],
  );

  const overlay = active ? (
    <TourOverlay key={active.run} tour={active.tour} steps={active.steps} onEnd={() => end(active.tour)} />
  ) : null;

  const activeId = active?.tour.id ?? null;
  const controls = useMemo(() => ({ available, start, activeId }), [available, start, activeId]);
  return { ...controls, controls, overlay };
}

const TourControlsContext = createContext<TourControls | null>(null);

/** Hands the shell's tour controls to the pages under it — an editor's own Help menu, say. */
export const TourControlsProvider = TourControlsContext.Provider;

export function useTourControls(): TourControls | null {
  return useContext(TourControlsContext);
}
