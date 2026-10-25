import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PreferenceStore } from '@neutrino/preferences';
import {
  AUTO_START_KEY,
  DRIVE_TOUR,
  SETTLE_MS,
  TourOverlay,
  autoStartAllowed,
  isTargetVisible,
  placeCard,
  resolveSteps,
  useTourController,
  type TourDefinition,
  type TourEnd,
} from '@/components/Tour';

// jsdom lays nothing out, so every element measures 0×0. An element with `data-rect` measures as
// it says ("left,top,width,height"), which is how a test puts a target on screen — or off it.
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
const OFF_LEFT = '-400,10,120,40';

const TOUR: TourDefinition = {
  id: 'drive',
  appName: 'Drive',
  startsOn: (p) => p === '/drive',
  home: '/drive',
  steps: [
    { target: 'one', title: 'First', body: 'The first step.' },
    { target: 'missing', title: 'Missing', body: 'Never shown: nothing carries this target.' },
    { target: 'two', title: 'Second', body: 'The second step.' },
    { target: 'drawer', title: 'Drawer', body: 'Never shown: it is off the left edge.' },
    { target: 'three', title: 'Third', body: 'The last step shown.' },
  ],
};

function Targets({ only }: { only?: string[] } = {}) {
  const show = (t: string) => !only || only.includes(t);
  return (
    <div>
      {show('one') && <button data-tour="one" data-rect={ON}>One</button>}
      {show('two') && <div data-tour="two" data-rect={ON}>Two</div>}
      <div data-tour="drawer" data-rect={OFF_LEFT}>Drawer</div>
      {show('three') && <div data-tour="three" data-rect={ON}>Three</div>}
    </div>
  );
}

describe('which steps a tour shows', () => {
  it('skips a step whose target is missing, empty, hidden or off screen across', () => {
    render(
      <>
        <Targets />
        <div data-tour="empty" />
        <div data-tour="hidden-attr" data-rect={ON} hidden />
        <div aria-hidden="true"><div data-tour="aria" data-rect={ON} /></div>
      </>,
    );
    const steps = resolveSteps([
      ...TOUR.steps,
      { target: 'empty', title: '', body: '' },
      { target: 'hidden-attr', title: '', body: '' },
      { target: 'aria', title: '', body: '' },
    ]);
    expect(steps.map((s) => s.step.title)).toEqual(['First', 'Second', 'Third']);
  });

  it('counts a target below the fold as visible — it is scrolled to', () => {
    render(<div data-tour="low" data-rect="10,5000,100,40" />);
    expect(isTargetVisible(document.querySelector('[data-tour="low"]')!)).toBe(true);
  });

  it('every Drive step names a target and says something', () => {
    expect(DRIVE_TOUR.steps.map((s) => s.target)).toEqual(['new', 'quick-access', 'file-filters', 'view-mode', 'top-right', 'storage']);
    for (const s of DRIVE_TOUR.steps) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(20);
    }
    expect(DRIVE_TOUR.startsOn('/drive')).toBe(true);
    expect(DRIVE_TOUR.startsOn('/drive/')).toBe(true);
    expect(DRIVE_TOUR.startsOn('/drive/recent')).toBe(false);
  });
});

describe('placing the card', () => {
  const viewport = { width: 1200, height: 800 };
  const card = { width: 300, height: 160 };

  it('goes on the preferred side when it fits, and the next one that does when not', () => {
    expect(placeCard({ top: 100, left: 100, width: 100, height: 40 }, card, viewport, 'bottom').placement).toBe('bottom');
    // Too near the bottom for below: above instead.
    expect(placeCard({ top: 700, left: 100, width: 100, height: 40 }, card, viewport, 'bottom').placement).toBe('top');
  });

  it('stays inside the window', () => {
    const pos = placeCard({ top: 100, left: 1150, width: 40, height: 40 }, card, viewport, 'bottom');
    expect(pos.left + card.width).toBeLessThanOrEqual(viewport.width - 16);
    expect(pos.left).toBeGreaterThanOrEqual(16);
  });

  it('centres without a target', () => {
    expect(placeCard(null, card, viewport)).toEqual({ top: 320, left: 450, placement: 'center' });
  });
});

/** The targets first, then the tour over them — steps resolve against what is on the page. */
function renderOverlay(onEnd: (how: TourEnd) => void) {
  const view = render(<Targets />);
  const steps = resolveSteps(TOUR.steps);
  view.rerender(<><Targets /><TourOverlay tour={TOUR} steps={steps} onEnd={onEnd} /></>);
  return view;
}

describe('the tour card', () => {
  it('numbers only the steps it shows, and walks them with Back and Next to Done', () => {
    const onEnd = vi.fn();
    renderOverlay(onEnd);
    const dialog = screen.getByRole('dialog', { name: 'Drive tour' });
    expect(dialog).toHaveTextContent('1 of 3');
    expect(dialog).toHaveTextContent('First');
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(dialog).toHaveTextContent('2 of 3');
    expect(dialog).toHaveTextContent('Second');
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(dialog).toHaveTextContent('1 of 3');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(dialog).toHaveTextContent('3 of 3');
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onEnd).toHaveBeenCalledWith('done');
  });

  it('ends as skipped from Skip tour and from Esc', () => {
    const onEnd = vi.fn();
    const { unmount } = renderOverlay(onEnd);
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    expect(onEnd).toHaveBeenLastCalledWith('skipped');
    unmount();

    const onEsc = vi.fn();
    renderOverlay(onEsc);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onEsc).toHaveBeenCalledWith('skipped');
  });

  it('moves focus to Next, and takes the arrow keys for Back and Next', () => {
    const onEnd = vi.fn();
    renderOverlay(onEnd);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next' }));
    const dialog = screen.getByRole('dialog', { name: 'Drive tour' });
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(dialog).toHaveTextContent('2 of 3');
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(dialog).toHaveTextContent('1 of 3');
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(dialog).toHaveTextContent('1 of 3');
  });

  it('puts the spotlight over the target', () => {
    renderOverlay(() => {});
    const spot = screen.getByTestId('tour-spotlight');
    // The target's box, padded by six pixels all round.
    expect(spot.style.top).toBe('4px');
    expect(spot.style.left).toBe('4px');
    expect(spot.style.width).toBe('132px');
    expect(spot.style.height).toBe('52px');
  });
});

interface HarnessProps {
  pathname?: string;
  ready?: boolean;
  blocked?: boolean;
  store: PreferenceStore;
  navigate?: (href: string) => void;
  modal?: boolean;
  only?: string[];
}

function Harness({ pathname = '/drive', ready = true, blocked = false, store, navigate, modal, only }: HarnessProps) {
  const tours = useTourController({ pathname, ready, blocked, store, navigate, tours: [TOUR] });
  return (
    <>
      <Targets only={only} />
      {modal && <div role="dialog" aria-modal="true">Upload files</div>}
      <button type="button" onClick={() => tours.start()}>Replay</button>
      <span data-testid="available">{tours.available?.id ?? 'none'}</span>
      {tours.overlay}
    </>
  );
}

function tourDialog() {
  return screen.queryByRole('dialog', { name: 'Drive tour' });
}

/** Two looks at the page: a tour starts once the number of steps it can show stops changing. */
async function settle(ms = SETTLE_MS * 2) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe('starting a tour', () => {
  let store: PreferenceStore;
  beforeEach(() => {
    vi.useFakeTimers();
    store = new PreferenceStore(null, null);
  });

  it('starts by itself the first time, once the page has settled', async () => {
    render(<Harness store={store} />);
    expect(tourDialog()).toBeNull();
    await settle();
    expect(tourDialog()).toHaveTextContent('1 of 3');
  });

  it('waits for the page to finish drawing, so a late part of it is not left out', async () => {
    const { rerender } = render(<Harness store={store} only={['one']} />);
    await settle(SETTLE_MS);
    expect(tourDialog()).toBeNull();
    rerender(<Harness store={store} />);
    await settle();
    expect(tourDialog()).toHaveTextContent('1 of 3');
  });

  it('marks the tour seen when it is finished', async () => {
    render(<Harness store={store} />);
    await settle();
    for (let i = 0; i < 2; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(tourDialog()).toBeNull();
    expect(store.get('onboarding.toursSeen')).toEqual(['drive']);
  });

  it('marks the tour seen when it is skipped, and does not start it again', async () => {
    render(<Harness store={store} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    expect(store.get('onboarding.toursSeen')).toEqual(['drive']);
    await settle(SETTLE_MS * 5);
    expect(tourDialog()).toBeNull();
  });

  it('does not start by itself once seen', async () => {
    store.set('onboarding.toursSeen', ['drive']);
    render(<Harness store={store} />);
    await settle(SETTLE_MS * 5);
    expect(tourDialog()).toBeNull();
  });

  it('waits for the user’s preferences and for the encryption gate', async () => {
    const { rerender } = render(<Harness store={store} ready={false} />);
    await settle(SETTLE_MS * 3);
    expect(tourDialog()).toBeNull();
    rerender(<Harness store={store} ready blocked />);
    await settle(SETTLE_MS * 3);
    expect(tourDialog()).toBeNull();
    rerender(<Harness store={store} ready blocked={false} />);
    await settle();
    expect(tourDialog()).not.toBeNull();
  });

  it('waits for another dialog to close rather than open over it', async () => {
    const { rerender } = render(<Harness store={store} modal />);
    await settle(SETTLE_MS * 3);
    expect(tourDialog()).toBeNull();
    rerender(<Harness store={store} />);
    await settle();
    expect(tourDialog()).not.toBeNull();
  });

  it('does not start on a route it does not run on', async () => {
    render(<Harness store={store} pathname="/drive/recent" />);
    await settle(SETTLE_MS * 5);
    expect(tourDialog()).toBeNull();
    // Still the Drive app's tour to replay, from anywhere in Drive.
    expect(screen.getByTestId('available')).toHaveTextContent('drive');
  });

  it('replays from the menu whether or not it has been seen', async () => {
    store.set('onboarding.toursSeen', ['drive']);
    render(<Harness store={store} />);
    await settle(SETTLE_MS * 3);
    expect(tourDialog()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    await settle(0);
    expect(tourDialog()).toHaveTextContent('1 of 3');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(tourDialog()).toBeNull();
    expect(store.get('onboarding.toursSeen')).toEqual(['drive']);
  });

  it('replayed from elsewhere, goes to the tour’s home first', async () => {
    const navigate = vi.fn();
    const { rerender } = render(<Harness store={store} pathname="/drive/recent" navigate={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(navigate).toHaveBeenCalledWith('/drive');
    await settle(0);
    expect(tourDialog()).toBeNull();
    rerender(<Harness store={store} pathname="/drive" navigate={navigate} />);
    await settle();
    expect(tourDialog()).not.toBeNull();
  });
});

describe('end-to-end runs', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
  });

  it('do not start tours by themselves under browser automation unless asked to', () => {
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    window.localStorage.removeItem(AUTO_START_KEY);
    expect(autoStartAllowed()).toBe(false);
    window.localStorage.setItem(AUTO_START_KEY, 'on');
    expect(autoStartAllowed()).toBe(true);
  });

  it('start them for everyone else, unless turned off on the device', () => {
    Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
    window.localStorage.removeItem(AUTO_START_KEY);
    expect(autoStartAllowed()).toBe(true);
    window.localStorage.setItem(AUTO_START_KEY, 'off');
    expect(autoStartAllowed()).toBe(false);
  });
});
