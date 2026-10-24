import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook } from '@testing-library/react';

const nav = vi.hoisted(() => ({ pathname: '/drive', search: '', push: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push }),
}));

import { EditorReturnTracker, isReturnRoute, useEditorExit } from '@/lib/editorReturn';

function visit(pathname: string, search = '') {
  nav.pathname = pathname;
  nav.search = search;
  render(<EditorReturnTracker />);
}

function exit(fallback?: string) {
  renderHook(() => useEditorExit(fallback)).result.current();
  return nav.push.mock.lastCall?.[0];
}

describe('editor back button', () => {
  beforeEach(() => {
    sessionStorage.clear();
    nav.push.mockClear();
  });

  it('returns to the Drive folder the document was opened from', () => {
    visit('/drive', 'folder=abc');
    visit('/docs/editor', 'id=doc-1');
    expect(exit()).toBe('/drive?folder=abc');
  });

  it('returns to an app library', () => {
    visit('/sheets');
    visit('/sheets/editor', 'id=s-1');
    expect(exit()).toBe('/sheets');
  });

  it('skips editors the user passed through on the way', () => {
    // Save As / Make a copy / New open another editor from inside one.
    visit('/drive/recent');
    visit('/docs/editor', 'id=a');
    visit('/docs/editor', 'id=b');
    visit('/open/doc/b');
    expect(exit()).toBe('/drive/recent');
  });

  it('falls back when the tab has only ever been in an editor', () => {
    visit('/notes/editor', 'id=n');
    expect(exit()).toBe('/drive');
    expect(exit('/diagrams')).toBe('/diagrams');
  });

  it('treats every editor route as somewhere not to return to', () => {
    for (const app of ['docs', 'sheets', 'slides', 'notes', 'diagrams', 'drawing', 'photos']) {
      expect(isReturnRoute(`/${app}/editor`)).toBe(false);
      expect(isReturnRoute(`/${app}`)).toBe(true);
    }
    expect(isReturnRoute('/drive')).toBe(true);
    expect(isReturnRoute('/search')).toBe(true);
  });
});
