/**
 * Onboarding phase 2: the eight app tours, and the three things the framework learnt for them —
 * a tour with no home (an editor's), a tour that waits for its page to draw (`waitFor`), and a
 * `display: contents` target measured by what it holds.
 */
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PreferenceStore, TOUR_IDS } from '@neutrino/preferences';
import { PanelRail, ShareButton, HamburgerMenu, Toolbar } from '@neutrino/ui';
import {
  AUTO_START_KEY,
  CALENDAR_TOUR,
  DIAGRAMS_TOUR,
  DOCS_TOUR,
  DRAWING_TOUR,
  DRIVE_TOUR,
  NOTES_TOUR,
  PHOTOS_TOUR,
  SETTLE_MS,
  SHEETS_TOUR,
  SLIDES_TOUR,
  TOURS,
  TourOverlay,
  isTargetVisible,
  replayLabel,
  resolveSteps,
  targetRect,
  tourForApp,
  tourOffered,
  tourName,
  useTourController,
  type TourDefinition,
} from '@/components/Tour';
import { MAX_WAIT_TRIES } from '@/components/Tour/useTours';
import { appForPath } from '@/lib/appForPath';

// As in tour.test.tsx: jsdom lays nothing out, so `data-rect` ("left,top,width,height") is how a
// test puts an element on screen.
const originalRect = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    const spec = this.getAttribute('data-rect');
    if (!spec) return originalRect.call(this);
    const [left, top, width, height] = spec.split(',').map(Number);
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  };
  window.localStorage.setItem(AUTO_START_KEY, 'on');
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = originalRect;
  window.localStorage.removeItem(AUTO_START_KEY);
  vi.useRealTimers();
});

const ON = '10,10,120,40';

/** Each app tour, the targets it points at in order, where it starts and where it does not. */
const EXPECTED: {
  tour: TourDefinition;
  targets: string[];
  runsOn: string;
  notOn: string[];
  home?: string;
}[] = [
  {
    tour: DOCS_TOUR,
    targets: ['docs-title', 'docs-toolbar', 'docs-outline', 'docs-comments', 'share', 'search'],
    runsOn: '/docs/editor',
    notOn: ['/docs', '/docs/editor/x', '/sheets/editor'],
  },
  {
    tour: SHEETS_TOUR,
    targets: ['sheets-formula-bar', 'sheets-number-format', 'sheets-chart', 'sheets-tabs', 'sheets-history', 'share'],
    runsOn: '/sheets/editor',
    notOn: ['/sheets', '/docs/editor'],
  },
  {
    tour: SLIDES_TOUR,
    targets: ['slides-list', 'slides-layout', 'slides-notes', 'slides-present', 'slides-export'],
    runsOn: '/slides/editor',
    notOn: ['/slides'],
  },
  {
    tour: NOTES_TOUR,
    targets: ['notes-editor', 'notes-editor', 'notes-title'],
    runsOn: '/notes/editor',
    notOn: ['/notes'],
  },
  {
    tour: PHOTOS_TOUR,
    targets: ['photos-upload', 'photos-collections', 'photos-keep', 'photos-info', 'photos-photo'],
    runsOn: '/photos',
    notOn: ['/photos/editor', '/photos/map'],
    home: '/photos',
  },
  {
    tour: CALENDAR_TOUR,
    targets: ['calendar-new', 'calendar-views', 'calendar-calendars', 'calendar-reminders', 'calendar-tasks'],
    runsOn: '/calendar',
    notOn: ['/calendar/settings'],
    home: '/calendar',
  },
  {
    tour: DIAGRAMS_TOUR,
    targets: ['diagrams-shapes', 'diagrams-canvas', 'diagrams-ai', 'diagrams-menu'],
    runsOn: '/diagrams/editor',
    notOn: ['/diagrams'],
  },
  {
    tour: DRAWING_TOUR,
    targets: ['drawing-tools', 'drawing-layers', 'drawing-style', 'drawing-menu'],
    runsOn: '/drawing/editor',
    notOn: ['/drawing'],
  },
];

describe('the app tours', () => {
  it('are one per app the seen preference knows, Drive’s included', () => {
    expect(TOURS.map((t) => t.id).sort()).toEqual([...TOUR_IDS].sort());
    expect(TOURS[0]).toBe(DRIVE_TOUR);
  });

  it.each(EXPECTED.map((e) => [e.tour.id, e] as const))('%s: points at its targets, in order', (_id, { tour, targets }) => {
    expect(tour.steps.map((s) => s.target)).toEqual(targets);
    for (const s of tour.steps) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(20);
    }
    // What it waits for is one of its own steps' targets, so it cannot wait for nothing.
    expect(targets).toContain(tour.waitFor);
  });

  it.each(EXPECTED.map((e) => [e.tour.id, e] as const))('%s: starts where its targets are, and is that app’s tour', (_id, { tour, runsOn, notOn, home }) => {
    expect(tour.startsOn(runsOn)).toBe(true);
    expect(tour.startsOn(`${runsOn}/`)).toBe(true);
    for (const p of notOn) expect(tour.startsOn(p)).toBe(false);
    expect(tourForApp(appForPath(runsOn))).toBe(tour);
    expect(tour.home).toBe(home);
    if (home) expect(tour.startsOn(home)).toBe(true);
  });

  it.each(EXPECTED.map((e) => [e.tour.id, e] as const))('%s: shows every step when every target is on screen', (_id, { tour }) => {
    const unique = Array.from(new Set(tour.steps.map((s) => s.target)));
    render(<div>{unique.map((t) => <div key={t} data-tour={t} data-rect={ON} />)}</div>);
    expect(resolveSteps(tour.steps)).toHaveLength(tour.steps.length);
  });

  it('are named as the menu and the card name them', () => {
    expect(replayLabel(DRAWING_TOUR)).toBe('Take the Drawings tour');
    expect(tourName(DOCS_TOUR)).toBe('Docs tour');
    expect(EXPECTED.map((e) => e.tour.appName)).toEqual(['Docs', 'Sheets', 'Slides', 'Notes', 'Photos', 'Calendar', 'Diagrams', 'Drawings']);
  });

  /**
   * A step whose target nothing carries is silently left out of every run, which looks exactly like
   * a tour that works. So: every target is written somewhere in the source, as a `data-tour`
   * attribute or a `tour:` field (rail panels, toolbar groups).
   */
  it('point only at targets something in the app carries', () => {
    const web = path.resolve(__dirname, '../../../../..');
    const roots = [path.join(web, 'apps/web/src'), path.join(web, 'packages/layout/src'), path.join(web, 'packages/ui/src')];
    let source = '';
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full);
        } else if (/\.tsx?$/.test(entry.name) && !full.includes(`${path.sep}Tour${path.sep}`)) {
          source += fs.readFileSync(full, 'utf8');
        }
      }
    };
    roots.forEach(walk);
    // An attribute (`data-tour="share"`), or a value handed to one (`tour: 'docs-outline'`,
    // `tour={i === 0 ? 'photos-photo' : undefined}`).
    const missing = TOURS.flatMap((t) => t.steps.map((s) => s.target)).filter(
      (target) => !source.includes(`data-tour="${target}"`) && !source.includes(`'${target}'`),
    );
    expect(missing).toEqual([]);
  });
});

describe('a tour that runs on a document', () => {
  it('is offered only where it runs: it has no home to go to', () => {
    expect(tourOffered(DOCS_TOUR, '/docs/editor')).toBe(true);
    expect(tourOffered(DOCS_TOUR, '/docs')).toBe(false);
    // One with a home is offered anywhere in its app.
    expect(tourOffered(PHOTOS_TOUR, '/photos/map')).toBe(true);
    expect(tourOffered(DRIVE_TOUR, '/drive/recent')).toBe(true);
  });
});

const EDITOR_TOUR: TourDefinition = {
  id: 'docs',
  appName: 'Docs',
  startsOn: (p) => p === '/docs/editor',
  waitFor: 'toolbar',
  steps: [
    { target: 'title', title: 'Title', body: 'The title of the open document.' },
    { target: 'toolbar', title: 'Toolbar', body: 'Drawn once the document has opened.' },
  ],
};

function Editor({ loaded }: { loaded: boolean }) {
  return (
    <>
      <input data-tour="title" data-rect={ON} />
      {loaded && <div data-tour="toolbar" data-rect={ON} />}
    </>
  );
}

function Harness({ pathname, loaded, store, navigate }: { pathname: string; loaded: boolean; store: PreferenceStore; navigate?: (href: string) => void }) {
  const tours = useTourController({ pathname, ready: true, blocked: false, store, navigate, tours: [EDITOR_TOUR] });
  return (
    <>
      <Editor loaded={loaded} />
      <button type="button" onClick={() => tours.start()}>Replay</button>
      <span data-testid="available">{tours.available?.id ?? 'none'}</span>
      {tours.overlay}
    </>
  );
}

const dialog = () => screen.queryByRole('dialog', { name: 'Docs tour' });

async function wait(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe('waiting for the page to draw', () => {
  let store: PreferenceStore;
  beforeEach(() => {
    vi.useFakeTimers();
    store = new PreferenceStore(null, null);
  });

  it('waits for its `waitFor` target — longer than a tour with nothing on screen gets — then shows every step', async () => {
    const { rerender } = render(<Harness pathname="/docs/editor" loaded={false} store={store} />);
    // Ten tries is when a tour with nothing to show gives up; this one is still waiting.
    await wait(SETTLE_MS * 20);
    expect(dialog()).toBeNull();
    rerender(<Harness pathname="/docs/editor" loaded store={store} />);
    await wait(SETTLE_MS * 3);
    expect(dialog()?.textContent).toContain('1 of 2');
  });

  it('gives up in the end, and does not start that session', async () => {
    const { rerender } = render(<Harness pathname="/docs/editor" loaded={false} store={store} />);
    await wait(SETTLE_MS * (MAX_WAIT_TRIES + 15));
    rerender(<Harness pathname="/docs/editor" loaded store={store} />);
    await wait(SETTLE_MS * 5);
    expect(dialog()).toBeNull();
    // Not marked seen: it never ran.
    expect(store.get('onboarding.toursSeen')).toEqual([]);
  });
});

describe('replaying a tour with no home', () => {
  let store: PreferenceStore;
  beforeEach(() => {
    vi.useFakeTimers();
    store = new PreferenceStore(null, null);
    store.set('onboarding.toursSeen', ['docs']);
  });

  it('is offered and replays in the editor', async () => {
    render(<Harness pathname="/docs/editor" loaded store={store} />);
    expect(screen.getByTestId('available').textContent).toBe('docs');
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    await wait(0);
    expect(dialog()?.textContent).toContain('1 of 2');
  });

  it('is not offered in the library, and goes nowhere if asked', async () => {
    const navigate = vi.fn();
    render(<Harness pathname="/docs" loaded store={store} navigate={navigate} />);
    expect(screen.getByTestId('available').textContent).toBe('none');
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    await wait(SETTLE_MS * 3);
    expect(navigate).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });
});

describe('a `display: contents` target', () => {
  function Group({ children }: { children?: React.ReactNode }) {
    return (
      <span data-tour="group" style={{ display: 'contents' }}>
        {children}
      </span>
    );
  }

  it('is measured as the box around what it holds', () => {
    render(
      <Group>
        <button data-rect="10,20,50,30">Favorites</button>
        <button data-rect="70,20,60,30">Archive</button>
      </Group>,
    );
    const el = document.querySelector('[data-tour="group"]')!;
    expect(targetRect(el)).toMatchObject({ left: 10, top: 20, width: 120, height: 30 });
    expect(isTargetVisible(el)).toBe(true);
  });

  it('is not on screen when nothing in it is', () => {
    render(<Group><button>Hidden</button></Group>);
    expect(isTargetVisible(document.querySelector('[data-tour="group"]')!)).toBe(false);
  });

  it('gets the spotlight around all of it', () => {
    render(
      <Group>
        <button data-rect="10,20,50,30">Favorites</button>
        <button data-rect="70,20,60,30">Archive</button>
      </Group>,
    );
    const tour: TourDefinition = { ...PHOTOS_TOUR, steps: [{ target: 'group', title: 'Group', body: 'Both tabs at once.' }] };
    render(<TourOverlay tour={tour} steps={resolveSteps(tour.steps)} onEnd={() => {}} />);
    const spot = screen.getByTestId('tour-spotlight');
    expect(spot.style.left).toBe('4px');
    expect(spot.style.top).toBe('14px');
    expect(spot.style.width).toBe('132px');
    expect(spot.style.height).toBe('42px');
  });
});

describe('what a tour can name in the shared components', () => {
  it('a rail panel’s tab', () => {
    render(
      <PanelRail
        panels={[{ id: 'comments', title: 'Comments', side: 'right', tour: 'docs-comments', content: <p>Body</p> }]}
        sides={['right']}
      >
        <div />
      </PanelRail>,
    );
    expect(document.querySelector('[data-tour="docs-comments"]')).toBe(screen.getByRole('tab', { name: 'Comments' }));
  });

  it('the Share button, a toolbar and a menu’s button', () => {
    render(
      <>
        <ShareButton onShare={() => {}} data-tour="share" />
        <Toolbar data-tour="docs-toolbar"><button>Bold</button></Toolbar>
        <HamburgerMenu items={[]} data-tour="diagrams-menu" />
      </>,
    );
    expect(document.querySelector('[data-tour="share"]')?.contains(screen.getByRole('button', { name: 'Share' }))).toBe(true);
    expect(document.querySelector('[data-tour="docs-toolbar"]')?.contains(screen.getByRole('button', { name: 'Bold' }))).toBe(true);
    expect(document.querySelector('[data-tour="diagrams-menu"]')).toBe(screen.getByRole('button', { name: 'Open menu' }));
  });
});
