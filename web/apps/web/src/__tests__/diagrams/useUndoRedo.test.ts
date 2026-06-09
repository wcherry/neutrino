/**
 * Tests for the useUndoRedo hook.
 *
 * Covers:
 * - Initial state: canUndo false, canRedo false
 * - After push: canUndo true, canRedo false
 * - After undo: state reverts to previous, canRedo true
 * - After redo: state advances, canRedo false
 * - canUndo stays false after undoing all history
 * - Multiple sequential undos work correctly
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUndoRedo } from '../../app/(apps)/diagrams/editor/hooks/useUndoRedo';

type TestState = { count: number };

describe('useUndoRedo', () => {
  it('initialises with empty history and no undo/redo available', () => {
    const initial: TestState = { count: 0 };
    const { result } = renderHook(() => useUndoRedo(initial));
    expect(result.current.state.count).toBe(0);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('can undo after a push', () => {
    const initial: TestState = { count: 0 };
    const { result } = renderHook(() => useUndoRedo(initial));
    act(() => result.current.push({ count: 1 }));
    expect(result.current.state.count).toBe(1);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('undo reverts to previous state', () => {
    const initial: TestState = { count: 0 };
    const { result } = renderHook(() => useUndoRedo(initial));
    act(() => result.current.push({ count: 1 }));
    act(() => result.current.push({ count: 2 }));
    act(() => result.current.undo());
    expect(result.current.state.count).toBe(1);
    expect(result.current.canRedo).toBe(true);
  });

  it('redo advances state after undo', () => {
    const initial: TestState = { count: 0 };
    const { result } = renderHook(() => useUndoRedo(initial));
    act(() => result.current.push({ count: 1 }));
    act(() => result.current.undo());
    act(() => result.current.redo());
    expect(result.current.state.count).toBe(1);
    expect(result.current.canRedo).toBe(false);
  });

  it('canUndo false after undoing all history', () => {
    const initial: TestState = { count: 0 };
    const { result } = renderHook(() => useUndoRedo(initial));
    act(() => result.current.push({ count: 1 }));
    act(() => result.current.undo());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.state.count).toBe(0);
  });

  it('pushing a new state clears redo history', () => {
    const initial: TestState = { count: 0 };
    const { result } = renderHook(() => useUndoRedo(initial));
    act(() => result.current.push({ count: 1 }));
    act(() => result.current.undo());
    act(() => result.current.push({ count: 2 }));
    expect(result.current.canRedo).toBe(false);
    expect(result.current.state.count).toBe(2);
  });

  it('multiple sequential undos work correctly', () => {
    const initial: TestState = { count: 0 };
    const { result } = renderHook(() => useUndoRedo(initial));
    act(() => result.current.push({ count: 1 }));
    act(() => result.current.push({ count: 2 }));
    act(() => result.current.push({ count: 3 }));
    act(() => result.current.undo());
    act(() => result.current.undo());
    expect(result.current.state.count).toBe(1);
  });
});
