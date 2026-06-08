'use client';

import { useState, useCallback } from 'react';

interface UndoRedoState<T> {
  state: T;
  canUndo: boolean;
  canRedo: boolean;
  push: (next: T) => void;
  undo: () => void;
  redo: () => void;
  reset: (next: T) => void;
}

/**
 * Generic undo/redo stack.
 * - push(next) — record a new state and clear the redo stack
 * - undo()     — revert to the previous state
 * - redo()     — advance to the next state (if available)
 * - reset(s)   — reset to a new initial state, clearing all history
 */
export function useUndoRedo<T>(initial: T): UndoRedoState<T> {
  // past[0] is the oldest, past[past.length-1] is the most recent undo candidate
  const [past, setPast] = useState<T[]>([]);
  const [present, setPresent] = useState<T>(initial);
  const [future, setFuture] = useState<T[]>([]);

  const push = useCallback((next: T) => {
    setPast((p) => [...p, present]);
    setPresent(next);
    setFuture([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present]);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [present, ...f]);
    setPresent(previous);
  }, [past, present]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, present]);
    setPresent(next);
  }, [future, present]);

  const reset = useCallback((next: T) => {
    setPast([]);
    setPresent(next);
    setFuture([]);
  }, []);

  return {
    state: present,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    push,
    undo,
    redo,
    reset,
  };
}
