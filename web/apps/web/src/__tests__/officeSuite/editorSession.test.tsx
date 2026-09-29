/**
 * Opening a second document of the same kind is a fresh editor (issue #214).
 *
 * The reported symptom was a warning — "This spreadsheet changed elsewhere since
 * you opened it" — on a spreadsheet created a second earlier by the New button,
 * with no new spreadsheet opened behind it. The New button pushes
 * `/sheets/editor?id=<new>` while the user is on `/sheets/editor?id=<old>`, and
 * the App Router reconciles a search-param change on the same route as the same
 * element: the editor was never remounted, so it kept the old document's state,
 * including the content-version guard whose `observe` only moves forward and so
 * would not take a brand-new file's `content_version` of 1.
 *
 * Every editor route has the same shape, so every one of them is covered here.
 * The assertion is deliberately about *mounting* rather than about the toast:
 * the guard is the piece that complained, but the grid, the file metadata the
 * next save writes under, the undo history and the stored OOXML package were all
 * equally stale, and only a fresh mount fixes the set.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

const { currentId, mounts } = vi.hoisted(() => ({
  currentId: { value: 'file-a' },
  mounts: [] as string[],
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(`id=${currentId.value}`),
}));

/**
 * A stand-in for each editor that records every mount. The real components pull
 * in the whole editing stack; what is under test is the route around them.
 */
function stubEditor(name: string) {
  return function Stub() {
    React.useEffect(() => {
      mounts.push(`${name}:${currentId.value}`);
    }, []);
    return <div data-testid={name} />;
  };
}

vi.mock('@/app/(apps)/sheets/editor/SheetEditor', () => ({ SheetEditor: stubEditor('sheets') }));
vi.mock('@/app/(apps)/docs/editor/DocEditor', () => ({ DocEditor: stubEditor('docs') }));
vi.mock('@/app/(apps)/slides/editor/SlideEditor', () => ({ SlideEditor: stubEditor('slides') }));
vi.mock('@/app/(apps)/diagrams/editor/DiagramEditor', () => ({ DiagramEditor: stubEditor('diagrams') }));
vi.mock('@/app/(apps)/drawing/editor/DrawingEditor', () => ({ DrawingEditor: stubEditor('drawing') }));

vi.mock('@neutrino/ui', () => ({ Spinner: () => <div /> }));

import SheetEditorPage from '@/app/(apps)/sheets/editor/page';
import DocEditorPage from '@/app/(apps)/docs/editor/page';
import SlideEditorPage from '@/app/(apps)/slides/editor/page';
import DiagramEditorPage from '@/app/(apps)/diagrams/editor/page';
import DrawingEditorPage from '@/app/(apps)/drawing/editor/page';

const ROUTES = [
  { app: 'sheets', Page: SheetEditorPage },
  { app: 'docs', Page: DocEditorPage },
  { app: 'slides', Page: SlideEditorPage },
  { app: 'diagrams', Page: DiagramEditorPage },
  { app: 'drawing', Page: DrawingEditorPage },
] as const;

beforeEach(() => {
  mounts.length = 0;
  currentId.value = 'file-a';
});

describe.each(ROUTES)('the $app editor route', ({ app, Page }) => {
  it('remounts the editor when ?id= changes, so no state crosses documents', async () => {
    const { rerender, findByTestId } = render(<Page />);
    await findByTestId(app);
    expect(mounts).toEqual([`${app}:file-a`]);

    // What the New button does: same route, different id, same element position.
    currentId.value = 'file-b';
    rerender(<Page />);
    await findByTestId(app);

    expect(mounts).toEqual([`${app}:file-a`, `${app}:file-b`]);
  });

  it('keeps one mount while the id is unchanged', async () => {
    const { rerender, findByTestId } = render(<Page />);
    await findByTestId(app);
    rerender(<Page />);
    await findByTestId(app);

    expect(mounts).toEqual([`${app}:file-a`]);
  });
});
