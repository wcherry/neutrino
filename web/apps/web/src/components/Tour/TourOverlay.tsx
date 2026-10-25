'use client';

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismiss, useKeyHandler } from '@neutrino/commands';
import { Button } from '@neutrino/ui';
import { findTarget, targetRect } from './targets';
import { placeCard, type Box } from './position';
import { tourName, type ResolvedStep, type TourDefinition } from './types';
import styles from './Tour.module.css';

/** Room left around the target inside the spotlight. */
const SPOTLIGHT_PADDING = 6;

export type TourEnd = 'done' | 'skipped';

export interface TourOverlayProps {
  tour: TourDefinition;
  /** Only the steps that could be shown when the tour started; "N of M" counts these. */
  steps: readonly ResolvedStep[];
  onEnd: (how: TourEnd) => void;
}

function boxOf(el: Element | null): Box | null {
  if (!el || !el.isConnected) return null;
  const r = targetRect(el);
  if (r.width <= 0 || r.height <= 0) return null;
  return {
    top: r.top - SPOTLIGHT_PADDING,
    left: r.left - SPOTLIGHT_PADDING,
    width: r.width + SPOTLIGHT_PADDING * 2,
    height: r.height + SPOTLIGHT_PADDING * 2,
  };
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * A guided tour on screen: the page dimmed except for a spotlight on the step's target, and a card
 * beside it. Esc skips; ← and → go back and forward; Enter presses the focused button, which is
 * Next (or Done) whenever a step opens. Focus stays in the card until the tour ends, then goes back
 * where it was.
 *
 * The target is looked up again on every measure rather than held: the page under a tour keeps
 * rendering (Drive's listing arrives, Quick access fills in) and may replace the element a step
 * was resolved against. A target that has gone entirely leaves the card centred over the dimmed
 * page, rather than ending the tour under the reader.
 */
export function TourOverlay({ tour, steps, onEnd }: TourOverlayProps) {
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Box | null>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number; placement: string } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  const titleId = useId();
  const bodyId = useId();

  const total = steps.length;
  const current = steps[Math.min(index, total - 1)];
  const last = index >= total - 1;

  const currentElement = useCallback(
    () => (current ? (current.element.isConnected ? current.element : findTarget(current.step.target)) : null),
    [current],
  );

  const measure = useCallback(() => {
    const box = boxOf(currentElement());
    setSpot((prev) =>
      prev && box && prev.top === box.top && prev.left === box.left && prev.width === box.width && prev.height === box.height
        ? prev
        : box,
    );
  }, [currentElement]);

  // A new step: bring its target into view if it is below (or above) the fold, then measure.
  useLayoutEffect(() => {
    const el = currentElement();
    if (el) {
      const r = targetRect(el);
      // A `display: contents` target has no box to scroll to; its first child stands in for it.
      const box = window.getComputedStyle(el).display === 'contents' ? (el.firstElementChild ?? el) : el;
      if (r.bottom < 0 || r.top > window.innerHeight) box.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    }
    measure();
  }, [currentElement, measure]);

  // Follow the target as the page moves under it.
  useEffect(() => {
    const el = currentElement();
    window.addEventListener('resize', measure);
    // Capture, so a scroll inside any container (Drive's own scroller, the sidebar) is heard.
    window.addEventListener('scroll', measure, true);
    let observer: ResizeObserver | undefined;
    if (el && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(el);
    }
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      observer?.disconnect();
    };
  }, [currentElement, measure]);

  // The card is placed once its own size is known, before it paints.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const size = { width: card.offsetWidth, height: card.offsetHeight };
    const next = placeCard(spot, size, viewport(), current?.step.placement);
    setCardPos((prev) => (prev && prev.top === next.top && prev.left === next.left && prev.placement === next.placement ? prev : next));
  }, [spot, current, index]);

  // Focus into the card when the tour opens and on every step; back where it was when it ends.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => {
      if (before && before.isConnected && typeof before.focus === 'function') before.focus();
    };
  }, []);
  // After the card is placed: until then it is transparent, and on the first frame it may not be
  // focusable at all.
  const placed = cardPos !== null;
  useEffect(() => {
    if (placed) cardRef.current?.querySelector<HTMLElement>('[data-tour-primary]')?.focus();
  }, [index, placed]);

  const next = useCallback(() => {
    if (last) endRef.current('done');
    else setIndex((i) => Math.min(i + 1, total - 1));
  }, [last, total]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Esc is a dismiss layer like any dialog's, so the key closes the tour and nothing under it.
  useDismiss(() => endRef.current('skipped'), true);

  // The rest of the keyboard, in the dispatcher's capture phase, before any element hears it:
  // nothing under a tour can be used while it is open, and the keys work wherever focus is. Through
  // the dispatcher rather than a listener of its own, as every key handler in the app is.
  useKeyHandler(
    (e: KeyboardEvent) => {
      const card = cardRef.current;
      if (!card) return;
      const inCard = card.contains(document.activeElement);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'ArrowRight') next();
        else back();
      } else if (e.key === 'Enter') {
        // A focused button in the card presses itself; anywhere else, Enter is Next.
        if (inCard && document.activeElement instanceof HTMLButtonElement) return;
        e.preventDefault();
        e.stopPropagation();
        next();
      } else if (e.key === 'Tab') {
        const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const lastItem = items[items.length - 1];
        if (!inCard) {
          e.preventDefault();
          (e.shiftKey ? lastItem : first).focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && document.activeElement === lastItem) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    { phase: 'capture' },
  );

  if (!current || typeof document === 'undefined') return null;

  const name = tourName(tour);
  return createPortal(
    <div className={styles.root} data-tour-overlay={tour.id}>
      {/* The page stays visible but cannot be clicked while a tour is on it. */}
      <div
        className={styles.blocker}
        aria-hidden="true"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
      />
      <div
        className={[styles.spotlight, spot ? '' : styles['spotlight-none']].filter(Boolean).join(' ')}
        style={spot ? { top: spot.top, left: spot.left, width: spot.width, height: spot.height } : undefined}
        aria-hidden="true"
        data-testid="tour-spotlight"
      />
      <div
        ref={cardRef}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        aria-describedby={`${titleId} ${bodyId}`}
        data-placement={cardPos?.placement}
        style={cardPos ? { top: cardPos.top, left: cardPos.left } : { top: 0, left: 0, opacity: 0 }}
      >
        <div className={styles.meta}>
          <span className={styles.name}>{name}</span>
          <span className={styles.count}>
            {index + 1} of {total}
          </span>
        </div>
        <div aria-live="polite">
          <h2 id={titleId} className={styles.title}>
            {current.step.title}
          </h2>
          <p id={bodyId} className={styles.body}>
            {current.step.body}
          </p>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={() => endRef.current('skipped')}>
            Skip tour
          </Button>
          <span className={styles.spacer} />
          <Button variant="secondary" size="sm" onClick={back} disabled={index === 0}>
            Back
          </Button>
          <Button variant="primary" size="sm" onClick={next} data-tour-primary="">
            {last ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
