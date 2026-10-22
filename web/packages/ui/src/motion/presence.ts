'use client';

import { useEffect, useState } from 'react';

/**
 * The motion names in `styles/motion.css`. An element takes one as `data-motion`, plus the
 * `data-state` that `usePresence` returns.
 */
export type MotionName =
  | 'fade'
  | 'scale'
  | 'rise'
  | 'drop'
  | 'expand'
  | 'toast'
  | 'drawer-left'
  | 'drawer-right'
  | 'drawer-bottom';

/** The longest exit in motion.css (drawers); a surface stays mounted this long after it closes. */
export const EXIT_MS = 200;

export type PresenceState = 'open' | 'closed';

/**
 * Whether a transient surface should be in the DOM, and which way it is animating — what
 * framer-motion's `AnimatePresence` did, in a few lines.
 *
 * Opening mounts it at once with `state: 'open'` (motion.css plays the enter keyframes on mount).
 * Closing keeps it mounted with `state: 'closed'` for `exitMs`, long enough for the exit
 * keyframes, then unmounts it. A timer rather than `animationend`: the event never fires under
 * reduced motion's near-zero durations in some browsers, nor in jsdom, and a surface that never
 * unmounts is worse than one that leaves a frame early.
 */
export function usePresence(open: boolean, exitMs: number = EXIT_MS): { mounted: boolean; state: PresenceState } {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, mounted, exitMs]);

  return { mounted: open || mounted, state: open ? 'open' : 'closed' };
}
