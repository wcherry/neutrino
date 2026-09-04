'use client';

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import styles from './FontSizeInput.module.css';

/** The sizes the drop-down offers. Typing is what covers everything else. */
export const DEFAULT_FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96];

export const MIN_FONT_SIZE = 1;
export const MAX_FONT_SIZE = 400;

export interface FontSizeInputProps {
  /** The size currently in effect. A string is accepted so callers can pass a stored value through. */
  value: number | string;
  /** Fired once per committed size — on Enter, on blur, on an arrow-key step, or on picking a preset. */
  onChange: (size: number) => void;
  /** Presets listed in the drop-down. */
  sizes?: number[];
  min?: number;
  max?: number;
  /** Decimal places a typed size is rounded to. */
  precision?: number;
  disabled?: boolean;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

/** Rounds to `precision` decimals without the float dust `toFixed` leaves behind. */
function round(n: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(n * factor) / factor;
}

/**
 * A font-size control that is typed into as well as picked from — the presets are a
 * shortcut, not the whole range (issue #137). Kept in @neutrino/ui because docs,
 * sheets and slides all show the same control and must accept the same sizes.
 */
export function FontSizeInput({
  value,
  onChange,
  sizes = DEFAULT_FONT_SIZES,
  min = MIN_FONT_SIZE,
  max = MAX_FONT_SIZE,
  precision = 1,
  disabled,
  title = 'Font size',
  className,
  style,
}: FontSizeInputProps) {
  const current = typeof value === 'number' ? value : parseFloat(value);
  const currentText = Number.isFinite(current) ? String(round(current, precision)) : String(value ?? '');

  const [draft, setDraft] = useState(currentText);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const listId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // The size already reported, so Enter (which commits and then blurs, and so commits
  // again on the way out) reports it once rather than twice.
  const committedRef = useRef(round(current, precision));

  // The size under the caret changes as the selection moves, so the field follows it —
  // but never while it is being typed into, which would rewrite the user's keystrokes.
  useEffect(() => {
    if (focused) return;
    setDraft(currentText);
    committedRef.current = round(current, precision);
  }, [currentText, current, precision, focused]);

  useEffect(() => {
    if (!open) return;

    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  // Keep the list on screen, and scroll the highlighted row into view for arrow-key use.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!open || !el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let { top, left } = pos;
    if (top + rect.height > window.innerHeight - pad) {
      const wrapRect = wrapperRef.current?.getBoundingClientRect();
      top = wrapRect ? wrapRect.top - rect.height - 4 : window.innerHeight - rect.height - pad;
      if (top < pad) top = pad;
    }
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
    if (left < pad) left = pad;
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    (el.children[highlight] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, pos, highlight]);

  function commit(next: number) {
    const clamped = round(Math.min(max, Math.max(min, next)), precision);
    setDraft(String(clamped));
    if (clamped === committedRef.current) return;
    committedRef.current = clamped;
    onChange(clamped);
  }

  /** Commits what has been typed, reverting to the current size if it is not a number. */
  function commitDraft() {
    const parsed = parseFloat(draft);
    if (Number.isFinite(parsed)) commit(parsed);
    else setDraft(currentText);
  }

  function step(delta: number) {
    const from = Number.isFinite(parseFloat(draft)) ? parseFloat(draft) : current;
    commit((Number.isFinite(from) ? from : min) + delta);
  }

  function openList() {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setHighlight(sizes.findIndex(s => round(s, precision) === round(current, precision)));
    setOpen(true);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // With the list open the arrows walk it; with it closed they step the size,
    // so one pair of keys never means two things at once.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) {
        setHighlight(h => {
          const next = e.key === 'ArrowDown' ? h + 1 : h - 1;
          return (next + sizes.length) % sizes.length;
        });
      } else if (e.key === 'ArrowDown' && e.altKey) {
        openList();
      } else {
        step(e.key === 'ArrowUp' ? 1 : -1);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && highlight >= 0) {
        commit(sizes[highlight]);
        setOpen(false);
      } else {
        commitDraft();
      }
      // Hand focus back to whatever the caller focused in onChange — the document
      // in docs, the grid in sheets — the way the drop-down used to.
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (open) setOpen(false);
      else {
        setDraft(currentText);
        inputRef.current?.blur();
      }
    }
  }

  const wrapperCls = [styles.wrapper, focused ? styles.focused : '', disabled ? styles.disabled : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div ref={wrapperRef} className={wrapperCls} style={style} title={title}>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          inputMode="decimal"
          role="combobox"
          aria-label={title}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && highlight >= 0 ? `${listId}-${highlight}` : undefined}
          autoComplete="off"
          disabled={disabled}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onFocus={e => {
            setFocused(true);
            e.target.select();
          }}
          onBlur={() => {
            setFocused(false);
            commitDraft();
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className={styles.caret}
          tabIndex={-1}
          aria-label={`${title} presets`}
          disabled={disabled}
          // Keeping focus where it is means opening the list never commits a half-typed size.
          onMouseDown={e => e.preventDefault()}
          onClick={() => (open ? setOpen(false) : openList())}
        >
          <ChevronDown size={13} />
        </button>
      </div>
      {open &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className={styles.list}
            style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width, zIndex: 9999 }}
          >
            {sizes.map((size, i) => {
              const selected = round(size, precision) === round(current, precision);
              const cls = [styles.option, i === highlight ? styles.highlighted : '', selected ? styles.selected : '']
                .filter(Boolean)
                .join(' ');
              return (
                <li
                  key={size}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={selected}
                  className={cls}
                  onMouseEnter={() => setHighlight(i)}
                  // Selecting on mousedown, before the input's blur can commit the draft.
                  onMouseDown={e => {
                    e.preventDefault();
                    commit(size);
                    setOpen(false);
                    inputRef.current?.blur();
                  }}
                >
                  {size}
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </>
  );
}
