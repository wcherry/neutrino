import type { ResolvedStep, TourStep } from './types';

export function targetSelector(target: string): string {
  return `[data-tour="${target.replace(/["\\]/g, '\\$&')}"]`;
}

type Rect = Pick<DOMRect, 'top' | 'left' | 'right' | 'bottom' | 'width' | 'height'>;

/**
 * Where `el` is drawn. An element that is `display: contents` has no box of its own — a toolbar's
 * tool wrapper, a group of tabs marked for a tour — so it is measured as the union of its
 * children's boxes, which is what it looks like on screen.
 */
export function targetRect(el: Element): Rect {
  if (typeof window === 'undefined' || window.getComputedStyle(el).display !== 'contents') return el.getBoundingClientRect();
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const child of Array.from(el.children)) {
    const r = targetRect(child);
    if (r.width <= 0 || r.height <= 0) continue;
    top = Math.min(top, r.top);
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  if (top === Infinity) return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  return { top, left, right, bottom, width: right - left, height: bottom - top };
}

/**
 * Whether a tour may point at `el`: laid out with a size, not hidden, not inside something
 * hidden from assistive technology, and at least partly on screen across. Down is not checked —
 * a target below the fold is scrolled to — but across is: at phone width the sidebar is a drawer
 * pushed off the left edge, and the storage meter in it is not something a step can show.
 */
export function isTargetVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  const rect = targetRect(el);
  if (rect.width <= 0 || rect.height <= 0) return false;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  if (rect.right <= 0 || rect.left >= viewportWidth) return false;
  if (el.closest('[aria-hidden="true"], [inert], [hidden]')) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  return true;
}

/** The first on-screen element a step points at, or null. */
export function findTarget(target: string, root: ParentNode = document): Element | null {
  for (const el of Array.from(root.querySelectorAll(targetSelector(target)))) {
    if (isTargetVisible(el)) return el;
  }
  return null;
}

/**
 * The steps that can be shown right now, in order. A step whose target is missing or off screen
 * (a collapsed sidebar, a closed panel, a phone-width layout) is left out, and the count the card
 * shows is of these — a tour never says "2 of 6" and then shows four.
 */
export function resolveSteps(steps: readonly TourStep[], root: ParentNode = document): ResolvedStep[] {
  const out: ResolvedStep[] = [];
  for (const step of steps) {
    const element = findTarget(step.target, root);
    if (element) out.push({ step, element });
  }
  return out;
}

/**
 * Whether a modal dialog other than a tour is open — the encryption gate, an upload, a share
 * dialog. A tour does not start over one.
 */
export function otherModalOpen(root: ParentNode = document): boolean {
  return Array.from(root.querySelectorAll('[aria-modal="true"]')).some(
    (el) => !el.closest('[data-tour-overlay]') && el.getAttribute('aria-hidden') !== 'true',
  );
}
