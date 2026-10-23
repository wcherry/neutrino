import { describe, it, expect } from 'vitest';
import {
  collapseRail,
  defaultLayout,
  dockPane,
  expandPane,
  floatPane,
  locate,
  movePane,
  normalizeLayout,
  paneSize,
  resizePane,
  togglePane,
  MAX_PANE_SIZE,
  MIN_PANE_SIZE,
  type RailLayout,
  type RailSpec,
} from '../components/rails/railLayout';

const spec: RailSpec = {
  sides: ['left', 'right', 'bottom'],
  panes: [
    { id: 'outline', side: 'left' },
    { id: 'pages', side: 'left' },
    { id: 'comments', side: 'right' },
    { id: 'history', side: 'right' },
    { id: 'console', side: 'bottom' },
  ],
};

/** Every pane exactly once, every expanded pane in its own rail — the invariants every operation keeps. */
function expectValid(layout: RailLayout) {
  const seen = [
    ...Object.values(layout.rails).flatMap((r) => r!.panes),
    ...Object.keys(layout.floating),
  ].sort();
  expect(seen).toEqual(spec.panes.map((p) => p.id).sort());
  for (const rail of Object.values(layout.rails)) {
    if (rail!.expanded !== null) expect(rail!.panes).toContain(rail!.expanded);
  }
}

describe('defaultLayout', () => {
  it('puts each pane in its declared rail, in order, with the requested ones open', () => {
    const layout = defaultLayout(spec, { left: 'outline' });
    expect(layout.rails.left).toEqual({ panes: ['outline', 'pages'], expanded: 'outline' });
    expect(layout.rails.right).toEqual({ panes: ['comments', 'history'], expanded: null });
    expect(layout.rails.top).toBeUndefined();
    expectValid(layout);
  });

  it('sends a pane declared for a rail the app does not have to its first rail', () => {
    const layout = defaultLayout({ sides: ['right'], panes: [{ id: 'a', side: 'left' }] });
    expect(layout.rails.right!.panes).toEqual(['a']);
  });
});

describe('expanding and collapsing', () => {
  it('keeps one pane open per rail', () => {
    let layout = defaultLayout(spec, { left: 'outline' });
    layout = expandPane(layout, 'pages');
    expect(layout.rails.left!.expanded).toBe('pages');
    layout = expandPane(layout, 'comments');
    // Another rail is independent.
    expect(layout.rails.left!.expanded).toBe('pages');
    expect(layout.rails.right!.expanded).toBe('comments');
  });

  it('a tab click opens its pane, and a second click on the open one collapses the rail', () => {
    let layout = defaultLayout(spec);
    layout = togglePane(layout, 'comments');
    expect(layout.rails.right!.expanded).toBe('comments');
    layout = togglePane(layout, 'comments');
    expect(layout.rails.right!.expanded).toBeNull();
    expect(collapseRail(defaultLayout(spec, { left: 'outline' }), 'left').rails.left!.expanded).toBeNull();
  });

  it('never mutates the layout it was given', () => {
    const before = defaultLayout(spec, { left: 'outline' });
    const copy = JSON.stringify(before);
    togglePane(before, 'pages');
    movePane(before, 'outline', 'right');
    floatPane(before, 'outline', { x: 10, y: 10, width: 300, height: 200 });
    resizePane(before, 'outline', 400);
    expect(JSON.stringify(before)).toBe(copy);
  });
});

describe('movePane', () => {
  it('moves a pane to another rail at an index and opens it there', () => {
    const layout = movePane(defaultLayout(spec, { left: 'outline' }), 'outline', 'right', 1);
    expect(layout.rails.left).toEqual({ panes: ['pages'], expanded: null });
    expect(layout.rails.right).toEqual({ panes: ['comments', 'outline', 'history'], expanded: 'outline' });
    expectValid(layout);
  });

  it('reorders within a rail, reading the index off the rail before the move', () => {
    // Drop 'outline' after 'pages' (index 2 in the rail as it was).
    const layout = movePane(defaultLayout(spec), 'outline', 'left', 2);
    expect(layout.rails.left!.panes).toEqual(['pages', 'outline']);
  });

  it('refuses a rail the app does not have', () => {
    const layout = defaultLayout(spec);
    expect(movePane(layout, 'outline', 'top')).toBe(layout);
  });
});

describe('floating', () => {
  it('lifts a pane out of its rail and remembers where it was', () => {
    const layout = floatPane(defaultLayout(spec, { right: 'history' }), 'history', { x: 40, y: 30, width: 320, height: 240 });
    expect(locate(layout, 'history')).toBe('floating');
    expect(layout.rails.right).toEqual({ panes: ['comments'], expanded: null });
    expect(layout.floating.history).toEqual({ rect: { x: 40, y: 30, width: 320, height: 240 }, home: 'right', homeIndex: 1 });
    expectValid(layout);
  });

  it('closing a floating pane returns it to the same place in its rail, open', () => {
    const floated = floatPane(defaultLayout(spec), 'comments', { x: 0, y: 0, width: 300, height: 200 });
    const docked = dockPane(floated, 'comments');
    expect(docked.rails.right).toEqual({ panes: ['comments', 'history'], expanded: 'comments' });
    expect(docked.floating).toEqual({});
    expectValid(docked);
  });

  it('moving a floating pane into a rail docks it there instead', () => {
    const floated = floatPane(defaultLayout(spec), 'comments', { x: 0, y: 0, width: 300, height: 200 });
    const moved = movePane(floated, 'comments', 'bottom', 0);
    expect(moved.rails.bottom!.panes).toEqual(['comments', 'console']);
    expectValid(moved);
  });

  it('keeps a floating window a usable size', () => {
    const layout = floatPane(defaultLayout(spec), 'console', { x: -50, y: -5, width: 20, height: 10 });
    expect(layout.floating.console.rect).toEqual({ x: 0, y: 0, width: 200, height: 140 });
  });
});

describe('sizes', () => {
  it('defaults by orientation and clamps what is set', () => {
    let layout = defaultLayout(spec);
    expect(paneSize(layout, 'outline', 'left')).toBe(280);
    expect(paneSize(layout, 'console', 'bottom')).toBe(220);
    layout = resizePane(layout, 'outline', 10);
    expect(layout.sizes.outline).toBe(MIN_PANE_SIZE);
    layout = resizePane(layout, 'outline', 99999);
    expect(layout.sizes.outline).toBe(MAX_PANE_SIZE);
  });
});

describe('normalizeLayout', () => {
  it('falls back to the default for nothing, garbage or an unknown version', () => {
    const fallback = defaultLayout(spec, { left: 'outline' });
    for (const raw of [undefined, null, 'x', 42, { version: 2 }, []]) {
      expect(normalizeLayout(raw, spec, { left: 'outline' })).toEqual(fallback);
    }
  });

  it('keeps the user’s arrangement and repairs everything else', () => {
    const stored = {
      version: 1,
      rails: {
        left: { panes: ['comments', 'ghost', 'comments'], expanded: 'outline' },
        right: { panes: ['history'], expanded: 'history' },
        top: { panes: ['console'], expanded: 'console' },
      },
      floating: {
        pages: { rect: { x: 5, y: 6, width: 300, height: 200 }, home: 'top', homeIndex: 3 },
        broken: { rect: { x: 1 } },
      },
      sizes: { comments: 300, ghost: 100, history: 'wide', outline: 5 },
    };
    const layout = normalizeLayout(stored, spec);
    // Unknown pane and duplicate dropped; the expanded pane not in that rail cleared.
    expect(layout.rails.left).toEqual({ panes: ['comments', 'outline'], expanded: null });
    expect(layout.rails.right).toEqual({ panes: ['history'], expanded: 'history' });
    // A rail the app no longer has is ignored; its pane goes back to its declared rail.
    expect(layout.rails.top).toBeUndefined();
    expect(layout.rails.bottom!.panes).toEqual(['console']);
    // A floating pane whose home rail is gone gets a home that exists.
    expect(layout.floating.pages.home).toBe('left');
    expect(layout.sizes).toEqual({ comments: 300, outline: MIN_PANE_SIZE });
    expectValid(layout);
  });

  it('adds a pane the stored layout has never seen to its declared rail', () => {
    const stored = { version: 1, rails: { left: { panes: ['outline'], expanded: null } }, floating: {}, sizes: {} };
    const layout = normalizeLayout(stored, spec);
    expect(layout.rails.left!.panes).toEqual(['outline', 'pages']);
    expectValid(layout);
  });
});
