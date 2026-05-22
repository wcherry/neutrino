import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToggle, usePrevious, useDebounce, useLocalStorage } from '../index';

// ---------------------------------------------------------------------------
// useToggle
// ---------------------------------------------------------------------------

describe('useToggle', () => {
  it('starts with false by default', () => {
    const { result } = renderHook(() => useToggle());
    expect(result.current[0]).toBe(false);
  });

  it('starts with a custom initial value of true', () => {
    const { result } = renderHook(() => useToggle(true));
    expect(result.current[0]).toBe(true);
  });

  it('toggles from false to true', () => {
    const { result } = renderHook(() => useToggle());
    act(() => { result.current[1](); });
    expect(result.current[0]).toBe(true);
  });

  it('toggles back to false after two toggles', () => {
    const { result } = renderHook(() => useToggle());
    act(() => { result.current[1](); });
    act(() => { result.current[1](); });
    expect(result.current[0]).toBe(false);
  });

  it('sets value directly via the third element', () => {
    const { result } = renderHook(() => useToggle());
    act(() => { result.current[2](true); });
    expect(result.current[0]).toBe(true);
    act(() => { result.current[2](false); });
    expect(result.current[0]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// usePrevious
// ---------------------------------------------------------------------------

describe('usePrevious', () => {
  it('returns undefined on the first render', () => {
    const { result } = renderHook(({ val }) => usePrevious(val), {
      initialProps: { val: 'initial' },
    });
    expect(result.current).toBeUndefined();
  });

  it('returns the previous value after an update', () => {
    const { result, rerender } = renderHook(({ val }) => usePrevious(val), {
      initialProps: { val: 'first' },
    });
    rerender({ val: 'second' });
    expect(result.current).toBe('first');
  });

  it('tracks each successive update', () => {
    const { result, rerender } = renderHook(({ val }) => usePrevious(val), {
      initialProps: { val: 1 },
    });
    rerender({ val: 2 });
    expect(result.current).toBe(1);
    rerender({ val: 3 });
    expect(result.current).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// useDebounce
// ---------------------------------------------------------------------------

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the initial value immediately without delay', () => {
    const { result } = renderHook(() => useDebounce('hello', 300));
    expect(result.current).toBe('hello');
  });

  it('does not update the value before the delay has elapsed', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'first', delay: 300 } }
    );
    rerender({ value: 'second', delay: 300 });
    vi.advanceTimersByTime(200);
    expect(result.current).toBe('first');
  });

  it('updates the value after the full delay has elapsed', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'first', delay: 300 } }
    );
    rerender({ value: 'second', delay: 300 });
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe('second');
  });

  it('resets the timer on rapid value changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'a', delay: 300 } }
    );
    rerender({ value: 'b', delay: 300 });
    vi.advanceTimersByTime(200);
    rerender({ value: 'c', delay: 300 });
    vi.advanceTimersByTime(200);
    // Still not updated — last change only 200ms ago
    expect(result.current).toBe('a');
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe('c');
  });
});

// ---------------------------------------------------------------------------
// useLocalStorage
// ---------------------------------------------------------------------------

describe('useLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the initial value when the key is not set', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 42));
    expect(result.current[0]).toBe(42);
  });

  it('reads an existing value from localStorage on mount', () => {
    localStorage.setItem('test-key', JSON.stringify(99));
    const { result } = renderHook(() => useLocalStorage('test-key', 0));
    expect(result.current[0]).toBe(99);
  });

  it('updates the state and persists the new value to localStorage', () => {
    const { result } = renderHook(() => useLocalStorage<number>('test-key', 0));
    act(() => { result.current[1](7); });
    expect(result.current[0]).toBe(7);
    expect(JSON.parse(localStorage.getItem('test-key')!)).toBe(7);
  });

  it('works with object values', () => {
    const { result } = renderHook(() =>
      useLocalStorage<{ name: string }>('obj-key', { name: 'default' })
    );
    act(() => { result.current[1]({ name: 'updated' }); });
    expect(result.current[0]).toEqual({ name: 'updated' });
    expect(JSON.parse(localStorage.getItem('obj-key')!)).toEqual({ name: 'updated' });
  });
});
