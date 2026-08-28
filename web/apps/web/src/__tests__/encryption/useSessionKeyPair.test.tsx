import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  initSodium,
  createKeyring,
  setSessionKeyring,
  clearSession,
} from '@neutrino/e2e-crypto';
import { useSessionKeyPair } from '@/hooks/useSessionKeyPair';

const USER = 'user-1';

beforeAll(async () => {
  await initSodium();
});

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  clearSession();
});

describe('useSessionKeyPair', () => {
  it('keeps the same keypair across re-renders', () => {
    // An unstable snapshot makes useSyncExternalStore re-render forever, which
    // is how the photo editor died on mount with "Maximum update depth
    // exceeded" (issue #149).
    setSessionKeyring(createKeyring(USER));

    const { result, rerender } = renderHook(() => useSessionKeyPair(USER));
    const first = result.current;
    rerender();
    rerender();

    expect(first).not.toBeNull();
    expect(result.current).toBe(first);
  });

  it('is null while locked and picks the key up on unlock', () => {
    const { result } = renderHook(() => useSessionKeyPair(USER));
    expect(result.current).toBeNull();

    act(() => {
      setSessionKeyring(createKeyring(USER));
    });
    expect(result.current).not.toBeNull();

    act(() => {
      clearSession();
    });
    expect(result.current).toBeNull();
  });

  it('holds no key for a user other than the unlocked one', () => {
    setSessionKeyring(createKeyring(USER));

    const { result } = renderHook(() => useSessionKeyPair('someone-else'));

    expect(result.current).toBeNull();
  });
});
