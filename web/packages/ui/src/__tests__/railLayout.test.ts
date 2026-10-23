import { describe, it, expect } from 'vitest';
import {
  collapseRail,
  defaultLayout,
  dockPanel,
  expandPanel,
  floatPanel,
  locate,
  movePanel,
  normalizeLayout,
  panelSize,
  resizePanel,
  togglePanel,
  MAX_PANEL_SIZE,
  MIN_PANEL_SIZE,
  type RailLayout,
  type RailSpec,
} from '../components/rails/railLayout';

const spec: RailSpec = {
  sides: ['left', 'right', 'bottom'],
  panels: [
    { id: 'outline', side: 'left' },
    { id: 'pages', side: 'left' },
    { id: 'comments', side: 'right' },
    { id: 'history', side: 'right' },
    { id: 'console', side: 'bottom' },
  ],
};

/** Every panel exactly once, every expanded panel in its own rail — the invariants every operation keeps. */
function expectValid(layout: RailLayout) {
  const seen = [
    ...Object.values(layout.rails).flatMap((r) => r!.panels),
    ...Object.keys(layout.floating),
  ].sort();
  expect(seen).toEqual(spec.panels.map((p) => p.id).sort());
  for (const rail of Object.values(layout.rails)) {
    if (rail!.expanded !== null) expect(rail!.panels).toContain(rail!.expanded);
  }
}

describe('defaultLayout', () => {
  it('puts each panel in its declared rail, in order, with the requested ones open', () => {
    const layout = defaultLayout(spec, { left: 'outline' });
    expect(layout.rails.left).toEqual({ panels: ['outline', 'pages'], expanded: 'outline' });
    expect(layout.rails.right).toEqual({ panels: ['comments', 'history'], expanded: null });
    expect(layout.rails.top).toBeUndefined();
    expectValid(layout);
  });

  it('sends a panel declared for a rail the app does not have to its first rail', () => {
    const layout = defaultLayout({ sides: ['right'], panels: [{ id: 'a', side: 'left' }] });
    expect(layout.rails.right!.panels).toEqual(['a']);
  });
});

describe('expanding and collapsing', () => {
  it('keeps one panel open per rail', () => {
    let layout = defaultLayout(spec, { left: 'outline' });
    layout = expandPanel(layout, 'pages');
    expect(layout.rails.left!.expanded).toBe('pages');
    layout = expandPanel(layout, 'comments');
    // Another rail is independent.
    expect(layout.rails.left!.expanded).toBe('pages');
    expect(layout.rails.right!.expanded).toBe('comments');
  });

  it('a tab click opens its panel, and a second click on the open one collapses the rail', () => {
    let layout = defaultLayout(spec);
    layout = togglePanel(layout, 'comments');
    expect(layout.rails.right!.expanded).toBe('comments');
    layout = togglePanel(layout, 'comments');
    expect(layout.rails.right!.expanded).toBeNull();
    expect(collapseRail(defaultLayout(spec, { left: 'outline' }), 'left').rails.left!.expanded).toBeNull();
  });

  it('never mutates the layout it was given', () => {
    const before = defaultLayout(spec, { left: 'outline' });
    const copy = JSON.stringify(before);
    togglePanel(before, 'pages');
    movePanel(before, 'outline', 'right');
    floatPanel(before, 'outline', { x: 10, y: 10, width: 300, height: 200 });
    resizePanel(before, 'outline', 400);
    expect(JSON.stringify(before)).toBe(copy);
  });
});

describe('movePanel', () => {
  it('moves a panel to another rail at an index and opens it there', () => {
    const layout = movePanel(defaultLayout(spec, { left: 'outline' }), 'outline', 'right', 1);
    expect(layout.rails.left).toEqual({ panels: ['pages'], expanded: null });
    expect(layout.rails.right).toEqual({ panels: ['comments', 'outline', 'history'], expanded: 'outline' });
    expectValid(layout);
  });

  it('reorders within a rail, reading the index off the rail before the move', () => {
    // Drop 'outline' after 'pages' (index 2 in the rail as it was).
    const layout = movePanel(defaultLayout(spec), 'outline', 'left', 2);
    expect(layout.rails.left!.panels).toEqual(['pages', 'outline']);
  });

  it('refuses a rail the app does not have', () => {
    const layout = defaultLayout(spec);
    expect(movePanel(layout, 'outline', 'top')).toBe(layout);
  });
});

describe('floating', () => {
  it('lifts a panel out of its rail and remembers where it was', () => {
    const layout = floatPanel(defaultLayout(spec, { right: 'history' }), 'history', { x: 40, y: 30, width: 320, height: 240 });
    expect(locate(layout, 'history')).toBe('floating');
    expect(layout.rails.right).toEqual({ panels: ['comments'], expanded: null });
    expect(layout.floating.history).toEqual({ rect: { x: 40, y: 30, width: 320, height: 240 }, home: 'right', homeIndex: 1 });
    expectValid(layout);
  });

  it('closing a floating panel returns it to the same place in its rail, open', () => {
    const floated = floatPanel(defaultLayout(spec), 'comments', { x: 0, y: 0, width: 300, height: 200 });
    const docked = dockPanel(floated, 'comments');
    expect(docked.rails.right).toEqual({ panels: ['comments', 'history'], expanded: 'comments' });
    expect(docked.floating).toEqual({});
    expectValid(docked);
  });

  it('moving a floating panel into a rail docks it there instead', () => {
    const floated = floatPanel(defaultLayout(spec), 'comments', { x: 0, y: 0, width: 300, height: 200 });
    const moved = movePanel(floated, 'comments', 'bottom', 0);
    expect(moved.rails.bottom!.panels).toEqual(['comments', 'console']);
    expectValid(moved);
  });

  it('keeps a floating window a usable size', () => {
    const layout = floatPanel(defaultLayout(spec), 'console', { x: -50, y: -5, width: 20, height: 10 });
    expect(layout.floating.console.rect).toEqual({ x: 0, y: 0, width: 200, height: 140 });
  });
});

describe('sizes', () => {
  it('defaults by orientation and clamps what is set', () => {
    let layout = defaultLayout(spec);
    expect(panelSize(layout, 'outline', 'left')).toBe(280);
    expect(panelSize(layout, 'console', 'bottom')).toBe(220);
    layout = resizePanel(layout, 'outline', 10);
    expect(layout.sizes.outline).toBe(MIN_PANEL_SIZE);
    layout = resizePanel(layout, 'outline', 99999);
    expect(layout.sizes.outline).toBe(MAX_PANEL_SIZE);
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
        left: { panels: ['comments', 'ghost', 'comments'], expanded: 'outline' },
        right: { panels: ['history'], expanded: 'history' },
        top: { panels: ['console'], expanded: 'console' },
      },
      floating: {
        pages: { rect: { x: 5, y: 6, width: 300, height: 200 }, home: 'top', homeIndex: 3 },
        broken: { rect: { x: 1 } },
      },
      sizes: { comments: 300, ghost: 100, history: 'wide', outline: 5 },
    };
    const layout = normalizeLayout(stored, spec);
    // Unknown panel and duplicate dropped; the expanded panel not in that rail cleared.
    expect(layout.rails.left).toEqual({ panels: ['comments', 'outline'], expanded: null });
    expect(layout.rails.right).toEqual({ panels: ['history'], expanded: 'history' });
    // A rail the app no longer has is ignored; its panel goes back to its declared rail.
    expect(layout.rails.top).toBeUndefined();
    expect(layout.rails.bottom!.panels).toEqual(['console']);
    // A floating panel whose home rail is gone gets a home that exists.
    expect(layout.floating.pages.home).toBe('left');
    expect(layout.sizes).toEqual({ comments: 300, outline: MIN_PANEL_SIZE });
    expectValid(layout);
  });

  it('adds a panel the stored layout has never seen to its declared rail', () => {
    const stored = { version: 1, rails: { left: { panels: ['outline'], expanded: null } }, floating: {}, sizes: {} };
    const layout = normalizeLayout(stored, spec);
    expect(layout.rails.left!.panels).toEqual(['outline', 'pages']);
    expectValid(layout);
  });
});
