'use client';

/**
 * The list of field codes, drawn against a point on screen.
 *
 * Shared by the two places a `{{` token can be typed — the body, where a
 * ProseMirror plugin decides what is open, and the header and footer bands,
 * which are plain inputs driven by `useFieldCodeAutocomplete`. Both hand this
 * component the same three things: the ranked items, the highlighted index, and
 * where to appear. It owns no state; the caller's key handling and this
 * component's clicks act on the same list, which is what keeps Enter and the
 * mouse from ever inserting different rows.
 *
 * Rendered through a portal onto `document.body`, which is the one thing here
 * that is not cosmetic. `position: fixed` resolves against the nearest
 * transformed ancestor rather than the viewport, and the editor scales the whole
 * page with a CSS transform for zoom — so a menu left inside the page would be
 * positioned relative to the sheet *and* scaled with it, which is wrong twice
 * over at any zoom but 100%.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FieldSuggestion } from '@/lib/docFields';
import styles from './FieldSuggestionMenu.module.css';

/** Enough room for the menu below the anchor; it flips above otherwise. */
export const MENU_MAX_HEIGHT = 260;
const GAP = 4;

/** Where the menu should sit: the token's box, in viewport coordinates. */
export interface SuggestionAnchor {
  left: number;
  top: number;
  bottom: number;
}

export interface FieldSuggestionListProps {
  items: FieldSuggestion[];
  index: number;
  anchor: SuggestionAnchor | null;
  onPick: (item: FieldSuggestion) => void;
}

export function FieldSuggestionList({ items, index, anchor, onPick }: FieldSuggestionListProps) {
  const listRef = useRef<HTMLUListElement>(null);
  // Portals need a DOM that exists, which it does not during the server render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Keep the highlighted row in view as the arrows walk past the fold.
  // Optional-called: scrolling a row into view is a nicety, and an environment
  // without `scrollIntoView` (jsdom, for one) must not take the menu down with
  // it — an exception here happens during the commit phase and unmounts the
  // whole tree, so the failure would be the editor going blank.
  useLayoutEffect(() => {
    const row = listRef.current?.children[index] as HTMLElement | undefined;
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [index]);

  if (!mounted || !anchor || items.length === 0) return null;

  const below = window.innerHeight - anchor.bottom;
  const flip = below < MENU_MAX_HEIGHT && anchor.top > below;
  const style: React.CSSProperties = flip
    ? { left: anchor.left, bottom: window.innerHeight - anchor.top + GAP }
    : { left: anchor.left, top: anchor.bottom + GAP };

  return createPortal(
    <div className={styles.menu} style={style} role="presentation">
      <ul
        ref={listRef}
        className={styles.list}
        role="listbox"
        aria-label="Field codes"
        style={{ maxHeight: MENU_MAX_HEIGHT }}
      >
        {items.map((item, i) => (
          <li
            key={item.code}
            role="option"
            aria-selected={i === index}
            className={`${styles.row} ${i === index ? styles.rowActive : ''}`}
            // On mousedown, and without taking focus: a click that moved the
            // caret out of the field would close the token before the handler
            // could replace it.
            onMouseDown={e => {
              e.preventDefault();
              onPick(item);
            }}
          >
            <span className={styles.code}>{`{{${item.code}}}`}</span>
            <span className={styles.label}>{item.label}</span>
            <span className={styles.hint}>{item.hint}</span>
          </li>
        ))}
      </ul>
      <div className={styles.footer}>
        <kbd className={styles.kbd}>↑</kbd>
        <kbd className={styles.kbd}>↓</kbd> to choose
        <kbd className={styles.kbd}>↵</kbd> to insert
        <kbd className={styles.kbd}>esc</kbd> to keep typing
      </div>
    </div>,
    document.body,
  );
}
