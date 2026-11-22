import { useEffect, useState } from 'react';

/**
 * Infinite scroll for a paged listing.
 *
 * Returns a ref callback for a sentinel placed after the last item, inside the
 * scrolling container (`FileGrid`'s `footer`) — so it works in the detailed
 * list, which scrolls itself, as well as the card views. Held in state rather
 * than a ref so the observer is attached as soon as the node mounts.
 */
export function useLoadMore(
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
  fetchNextPage: () => unknown,
): (el: HTMLDivElement | null) => void {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!el || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) fetchNextPage(); },
      { rootMargin: '400px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, hasNextPage, isFetchingNextPage, fetchNextPage]);
  return setEl;
}
