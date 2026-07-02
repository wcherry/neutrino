'use client';

import { useState, useCallback } from 'react';

interface UndoRedoState<T> {
  state: T;
  canUndo: boolean;
  canRedo: boolean;
  push: (next: T | ((prev: T) => T)) => void;
  undo: () => void;
  redo: () => void;
  reset: (next: T) => void;
}

interface History<T> {
  // past[0] is the oldest, past[past.length-1] is the most recent undo candidate
  past: T[];
  present: T;
  future: T[];
}

/**
 * Generic undo/redo stack.
 * - push(next) — record a new state and clear the redo stack. Accepts either a
 *   value or an updater function; the updater form is required for correctness
 *   when multiple push() calls happen synchronously back-to-back (e.g. addShape()
 *   immediately followed by updateShape()) — each one operates on the previous
 *   call's result rather than a stale `present` closure.
 * - undo()     — revert to the previous state
 * - redo()     — advance to the next state (if available)
 * - reset(s)   — reset to a new initial state, clearing all history
 *
 * All three fields live in a single state object so that a push/undo/redo is one
 * atomic transition — there's no window where past/present/future disagree.
 */
export function useUndoRedo<T>(initial: T): UndoRedoState<T> {
  const [history, setHistory] = useState<History<T>>({ past: [], present: initial, future: [] });

  const push = useCallback((next: T | ((prev: T) => T)) => {
    setHistory((h) => ({
      past: [...h.past, h.present],
      present: typeof next === 'function' ? (next as (prev: T) => T)(h.present) : next,
      future: [],
    }));
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.past.length === 0) return h;
      const previous = h.past[h.past.length - 1];
      return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((h) => {
      if (h.future.length === 0) return h;
      const next = h.future[0];
      return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
    });
  }, []);

  const reset = useCallback((next: T) => {
    setHistory({ past: [], present: next, future: [] });
  }, []);

  return {
    state: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    push,
    undo,
    redo,
    reset,
  };
}
