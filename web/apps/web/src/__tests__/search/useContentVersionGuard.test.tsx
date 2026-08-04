/**
 * Tests for the editor-side stale-save guard.
 *
 * What matters here is the shape of the conversation with the server: assert
 * the revision you last saw, recognise the rejection, and make the *next* save
 * the deliberate overwrite the user was told about. Getting the last part wrong
 * either leaves the user unable to save at all, or turns every save into a
 * force and defeats the guard entirely.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ApiClientError } from '@neutrino/api-core';
import { useContentVersionGuard } from '@/hooks/useContentVersionGuard';

function conflict() {
  return new ApiClientError(409, 'CONTENT_VERSION_CONFLICT', 'changed on the server');
}

describe('useContentVersionGuard', () => {
  it('leaves saves unguarded until a version is known', () => {
    const { result } = renderHook(() => useContentVersionGuard());
    expect(result.current.check()).toBeUndefined();
  });

  it('asserts an initial version when one is supplied', () => {
    const { result } = renderHook(() => useContentVersionGuard(7));
    expect(result.current.check()).toEqual({ expectedContentVersion: 7 });
  });

  it('asserts the newest observed version', () => {
    const { result } = renderHook(() => useContentVersionGuard(1));
    act(() => result.current.observe(4));
    expect(result.current.check()).toEqual({ expectedContentVersion: 4 });
  });

  it('ignores an undefined observation rather than dropping the guard', () => {
    // An endpoint that does not report a version must not silently disarm the
    // guard for every save that follows.
    const { result } = renderHook(() => useContentVersionGuard(3));
    act(() => result.current.observe(undefined));
    expect(result.current.check()).toEqual({ expectedContentVersion: 3 });
  });

  it('recognises a version conflict', () => {
    const { result } = renderHook(() => useContentVersionGuard(1));
    let handled = false;
    act(() => {
      handled = result.current.handleError(conflict());
    });
    expect(handled).toBe(true);
    expect(result.current.hasConflict).toBe(true);
  });

  it('does not claim unrelated failures', () => {
    const { result } = renderHook(() => useContentVersionGuard(1));
    let handled = true;
    act(() => {
      handled = result.current.handleError(new Error('network down'));
    });
    expect(handled).toBe(false);
    expect(result.current.hasConflict).toBe(false);
  });

  it('makes the save after a conflict the overwrite the user was offered', () => {
    const { result } = renderHook(() => useContentVersionGuard(1));
    act(() => {
      result.current.handleError(conflict());
    });

    let next;
    act(() => {
      next = result.current.check();
    });
    expect(next).toEqual({ force: true });
  });

  it('re-arms after the overwrite instead of forcing forever', () => {
    const { result } = renderHook(() => useContentVersionGuard(1));
    act(() => {
      result.current.handleError(conflict());
    });
    act(() => {
      result.current.check();
    });
    // The forced save reported the revision it produced.
    act(() => result.current.observe(9));

    expect(result.current.check()).toEqual({ expectedContentVersion: 9 });
    expect(result.current.hasConflict).toBe(false);
  });

  it('clears the conflict flag once the overwrite is issued', () => {
    const { result } = renderHook(() => useContentVersionGuard(1));
    act(() => {
      result.current.handleError(conflict());
    });
    expect(result.current.hasConflict).toBe(true);

    act(() => {
      result.current.check();
    });
    expect(result.current.hasConflict).toBe(false);
  });

  it('dismisses a conflict without turning the next save into a force', () => {
    // The reload path: the user is discarding their copy, so the save that
    // follows must be guarded like any other.
    const { result } = renderHook(() => useContentVersionGuard(1));
    act(() => {
      result.current.handleError(conflict());
    });
    act(() => result.current.dismiss());

    expect(result.current.hasConflict).toBe(false);
    expect(result.current.check()).toEqual({ expectedContentVersion: 1 });
  });

  it('keeps `check` stable across renders so mutations are not rebuilt per keystroke', () => {
    const { result, rerender } = renderHook(() => useContentVersionGuard(1));
    const first = result.current.check;
    rerender();
    expect(result.current.check).toBe(first);
  });
});

describe('ApiClientError conflict detection', () => {
  it('matches on the code, not the status, so other 409s are not swallowed', async () => {
    const { isContentVersionConflict } = await import('@neutrino/api-core');
    expect(isContentVersionConflict(conflict())).toBe(true);
    expect(
      isContentVersionConflict(new ApiClientError(409, 'ALREADY_EXISTS', 'name taken')),
    ).toBe(false);
    expect(isContentVersionConflict(new Error('nope'))).toBe(false);
    expect(isContentVersionConflict(undefined)).toBe(false);
  });
});

describe('contentVersionQuery', () => {
  it('is empty when there is no guard, so unguarded saves are unchanged', async () => {
    const { contentVersionQuery } = await import('@neutrino/api-core');
    expect(contentVersionQuery(undefined)).toBe('');
    expect(contentVersionQuery({})).toBe('');
  });

  it('sends the expected version', async () => {
    const { contentVersionQuery } = await import('@neutrino/api-core');
    expect(contentVersionQuery({ expectedContentVersion: 5 })).toBe('?expectedContentVersion=5');
  });

  it('sends force on its own, without an expected version', async () => {
    const { contentVersionQuery } = await import('@neutrino/api-core');
    expect(contentVersionQuery({ force: true })).toBe('?force=true');
  });

  it('omits force when it is false rather than sending a no-op parameter', async () => {
    const { contentVersionQuery } = await import('@neutrino/api-core');
    expect(contentVersionQuery({ expectedContentVersion: 2, force: false })).toBe(
      '?expectedContentVersion=2',
    );
  });
});
