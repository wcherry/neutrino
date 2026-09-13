import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDriveLiveUpdates } from '@/hooks/useDriveLiveUpdates';
import { DRIVE_CHANGED_EVENT } from '@/lib/driveLiveUpdates';

// ---------------------------------------------------------------------------
// useDriveLiveUpdates — the shell's single subscription to drive changes.
//
// Signals are pushed to whoever is connected and queued for nobody, so the interesting cases are
// all about gaps: what happens when the socket was down, and what must NOT happen on the first
// connect of a page that has just read everything anyway.
// ---------------------------------------------------------------------------

const LISTING_KEY = ['contents', 'folder-1', 'user-1'];

function harness() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(LISTING_KEY, { seeded: true });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const listingIsStale = () => queryClient.getQueryState(LISTING_KEY)?.isInvalidated === true;
  const freshen = () => queryClient.setQueryData(LISTING_KEY, { seeded: true });

  return { queryClient, wrapper, listingIsStale, freshen };
}

describe('useDriveLiveUpdates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-reads the listing when a change is announced', async () => {
    const { wrapper, listingIsStale } = harness();
    renderHook(() => useDriveLiveUpdates({ connected: true }), { wrapper });

    await act(async () => {
      window.dispatchEvent(new CustomEvent(DRIVE_CHANGED_EVENT));
    });

    expect(listingIsStale()).toBe(true);
  });

  it('stops listening once unmounted', async () => {
    const { wrapper, listingIsStale } = harness();
    const { unmount } = renderHook(() => useDriveLiveUpdates({ connected: true }), { wrapper });

    unmount();
    await act(async () => {
      window.dispatchEvent(new CustomEvent(DRIVE_CHANGED_EVENT));
    });

    expect(listingIsStale()).toBe(false);
  });

  /**
   * The page read its listing on mount a moment earlier. Invalidating on the first connect would
   * make every single page load fetch its folder twice.
   */
  it('does not re-read on the first connect', async () => {
    const { wrapper, listingIsStale } = harness();
    const { rerender } = renderHook(
      ({ connected }) => useDriveLiveUpdates({ connected }),
      { wrapper, initialProps: { connected: false } }
    );

    await act(async () => {
      rerender({ connected: true });
    });

    expect(listingIsStale()).toBe(false);
  });

  /**
   * The catch-up that makes a gap survivable without knowing what caused it — a dropped
   * connection, a sleeping laptop, a proxy timing out an idle socket. Anything pushed while the
   * socket was down is gone, so the reconnect itself has to be the trigger.
   */
  it('re-reads on a reconnect, since signals sent while it was down were never queued', async () => {
    const { wrapper, listingIsStale, freshen } = harness();
    const { rerender } = renderHook(
      ({ connected }) => useDriveLiveUpdates({ connected }),
      { wrapper, initialProps: { connected: false } }
    );

    await act(async () => {
      rerender({ connected: true });
    });
    freshen();

    await act(async () => {
      rerender({ connected: false });
    });
    await act(async () => {
      rerender({ connected: true });
    });

    expect(listingIsStale()).toBe(true);
  });

  it('polls while the socket is down', async () => {
    const { wrapper, listingIsStale } = harness();
    renderHook(() => useDriveLiveUpdates({ connected: false }), { wrapper });

    expect(listingIsStale()).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(listingIsStale()).toBe(true);
  });

  it('does not poll while the socket is up', async () => {
    const { wrapper, listingIsStale } = harness();
    renderHook(() => useDriveLiveUpdates({ connected: true }), { wrapper });

    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });

    expect(listingIsStale()).toBe(false);
  });

  /**
   * A hidden tab is showing no listing, and React Query refetches on focus anyway — so polling one
   * spends the user's battery to refresh something nobody is looking at.
   */
  it('does not poll while the tab is hidden', async () => {
    const { wrapper, listingIsStale } = harness();
    const visibility = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden');

    renderHook(() => useDriveLiveUpdates({ connected: false }), { wrapper });

    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });

    expect(listingIsStale()).toBe(false);
    visibility.mockRestore();
  });

  it('stops polling once unmounted', async () => {
    const { wrapper, listingIsStale } = harness();
    const { unmount } = renderHook(() => useDriveLiveUpdates({ connected: false }), { wrapper });

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });

    expect(listingIsStale()).toBe(false);
  });
});
