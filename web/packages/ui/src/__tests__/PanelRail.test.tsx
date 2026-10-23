/**
 * The rail control as someone uses it: tabs open and collapse panels one per rail, a panel moves by
 * its menu or by dragging its tab, a floating panel returns to its rail when closed, and the layout
 * it reports is what an app would store.
 *
 * jsdom does no layout, so the drag tests give the strips, tabs and view rectangles by hand.
 */

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { PanelRail, type RailPanel } from '../components/rails/PanelRail';
import type { RailLayout, RailSide } from '../components/rails/railLayout';

beforeAll(() => {
  // jsdom has no PointerEvent; a MouseEvent carries everything these handlers read.
  if (typeof window.PointerEvent === 'undefined') {
    class FakePointerEvent extends MouseEvent {}
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = FakePointerEvent;
  }
});

function panels(): RailPanel[] {
  return [
    { id: 'outline', title: 'Outline', side: 'left', content: <p>Outline body</p> },
    { id: 'pages', title: 'Pages', side: 'left', content: <input aria-label="Page filter" /> },
    { id: 'comments', title: 'Comments', side: 'right', content: <p>Comments body</p> },
    { id: 'console', title: 'Console', side: 'bottom', content: <p>Console body</p> },
  ];
}

function setup(props: { sides?: RailSide[]; layout?: unknown; defaultExpanded?: Partial<Record<RailSide, string>> } = {}) {
  const onLayoutChange = vi.fn<(l: RailLayout) => void>();
  const utils = render(
    <div style={{ width: 1000, height: 700 }}>
      <PanelRail
        panels={panels()}
        sides={props.sides ?? ['left', 'right', 'bottom']}
        defaultLayout={props.layout}
        defaultExpanded={props.defaultExpanded ?? { left: 'outline' }}
        onLayoutChange={onLayoutChange}
      >
        <main>The document</main>
      </PanelRail>
    </div>,
  );
  return { ...utils, onLayoutChange };
}

const rail = (name: string) => screen.getByRole('tablist', { name });
const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0] as RailLayout;

function rect(el: Element, r: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () =>
    ({ ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r }) as DOMRect;
}

/** A 1000×700 workspace: left strip at x 0–30, right strip at x 970–1000, view in between. */
function giveGeometry(container: HTMLElement) {
  rect(rail('Left panels'), { left: 0, top: 0, width: 30, height: 700 });
  rect(rail('Right panels'), { left: 970, top: 0, width: 30, height: 700 });
  rect(rail('Bottom panels'), { left: 0, top: 670, width: 1000, height: 30 });
  within(rail('Right panels')).getAllByRole('tab').forEach((tab, i) => rect(tab, { left: 970, top: 10 + i * 90, width: 30, height: 80 }));
  within(rail('Left panels')).getAllByRole('tab').forEach((tab, i) => rect(tab, { left: 0, top: 10 + i * 90, width: 30, height: 80 }));
  rect(container.querySelector('[data-rail-view]')!, { left: 330, top: 0, width: 640, height: 670 });
}

function dragTab(tab: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.pointerDown(tab, { button: 0, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(window, { clientX: from.x + 10, clientY: from.y + 10 });
  fireEvent.pointerMove(window, { clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(window, { clientX: to.x, clientY: to.y });
  // A real browser follows pointerup on the pressed button with a click.
  fireEvent.click(tab);
}

describe('PanelRail', () => {
  it('shows each rail as a strip of tabs, with only the open panel rendered', () => {
    setup();
    expect(within(rail('Left panels')).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Outline', 'Pages']);
    expect(rail('Left panels')).toHaveAttribute('aria-orientation', 'vertical');
    expect(rail('Bottom panels')).toHaveAttribute('aria-orientation', 'horizontal');
    expect(screen.getByRole('tab', { name: 'Outline' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Outline' })).toHaveTextContent('Outline body');
    expect(screen.queryByText('Comments body')).toBeNull();
    expect(screen.getByText('The document')).toBeInTheDocument();
  });

  it('opens one panel per rail, and a second click on the open tab collapses the rail', () => {
    const { onLayoutChange } = setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Pages' }));
    expect(screen.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Outline' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel', { name: 'Pages' })).toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: 'Comments' }));
    // Another rail opens independently.
    expect(screen.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true');
    expect(last(onLayoutChange).rails.right!.expanded).toBe('comments');

    fireEvent.click(screen.getByRole('tab', { name: 'Comments' }));
    expect(last(onLayoutChange).rails.right!.expanded).toBeNull();
    expect(screen.queryByRole('tabpanel', { name: 'Comments' })).toBeNull();
  });

  it('collapses from the panel’s button or Escape, and gives focus back to its tab', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Outline' }));
    expect(screen.getByRole('tab', { name: 'Outline' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Outline' })).toHaveFocus();

    fireEvent.click(screen.getByRole('tab', { name: 'Pages' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Page filter' }), { key: 'Escape' });
    expect(screen.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Pages' })).toHaveFocus();
  });

  it('keeps a panel’s content mounted while it is collapsed', () => {
    setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Pages' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Page filter' }), { target: { value: 'draft' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Outline' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Pages' }));
    expect(screen.getByRole('textbox', { name: 'Page filter' })).toHaveValue('draft');
  });

  it('moves focus along a strip with the arrow keys of its orientation', () => {
    setup();
    const outline = screen.getByRole('tab', { name: 'Outline' });
    outline.focus();
    fireEvent.keyDown(outline, { key: 'ArrowDown' });
    expect(screen.getByRole('tab', { name: 'Pages' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Pages' }), { key: 'ArrowDown' });
    expect(outline).toHaveFocus();
    // Only the open (or first) tab is in the page's tab order.
    expect(screen.getByRole('tab', { name: 'Pages' })).toHaveAttribute('tabindex', '-1');
  });

  it('moves a panel to another rail from its menu, and opens it there', () => {
    const { onLayoutChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Move Outline' }));
    const menu = screen.getByRole('menu', { name: 'Move Outline' });
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Move to right rail',
      'Move to bottom rail',
      'Float',
    ]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move to right rail' }));
    expect(within(rail('Right panels')).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Comments', 'Outline']);
    expect(screen.getByRole('tab', { name: 'Outline' })).toHaveAttribute('aria-selected', 'true');
    expect(last(onLayoutChange).rails.left).toEqual({ panels: ['pages'], expanded: null });
  });

  it('Escape in the move menu closes the menu, not the panel', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Move Outline' }));
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Float' }), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Move Outline' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Outline' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Escape during a drag drops it where it started', () => {
    const { container } = setup();
    giveGeometry(container);
    const pages = screen.getByRole('tab', { name: 'Pages' });
    fireEvent.pointerDown(pages, { button: 0, clientX: 15, clientY: 120 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 300 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(window, { clientX: 985, clientY: 150 });
    expect(within(rail('Left panels')).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Outline', 'Pages']);
  });

  it('offers only Float when the view has a single rail', () => {
    setup({ sides: ['left'] });
    fireEvent.click(screen.getByRole('button', { name: 'Move Outline' }));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Float']);
  });

  it('moves a panel by dragging its tab onto another rail, at the place it is dropped', () => {
    const { container, onLayoutChange } = setup();
    giveGeometry(container);
    // Onto the right strip, below Comments (its tab spans y 10–90).
    dragTab(screen.getByRole('tab', { name: 'Pages' }), { x: 15, y: 120 }, { x: 985, y: 150 });
    expect(within(rail('Right panels')).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Comments', 'Pages']);
    expect(last(onLayoutChange).rails.right).toEqual({ panels: ['comments', 'pages'], expanded: 'pages' });
    // The click that ends the drag did not toggle it closed again.
    expect(screen.getByRole('tab', { name: 'Pages' })).toHaveAttribute('aria-selected', 'true');
  });

  it('a short press is a click, not a drag', () => {
    const { container } = setup();
    giveGeometry(container);
    const pages = screen.getByRole('tab', { name: 'Pages' });
    fireEvent.pointerDown(pages, { button: 0, clientX: 15, clientY: 120 });
    fireEvent.pointerMove(window, { clientX: 17, clientY: 121 });
    fireEvent.pointerUp(window, { clientX: 17, clientY: 121 });
    fireEvent.click(pages);
    expect(within(rail('Left panels')).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Outline', 'Pages']);
    expect(pages).toHaveAttribute('aria-selected', 'true');
  });

  it('floats a tab dropped on the view, and closing it returns it to the same place, open', () => {
    const { container, onLayoutChange } = setup();
    giveGeometry(container);
    dragTab(screen.getByRole('tab', { name: 'Outline' }), { x: 15, y: 30 }, { x: 600, y: 300 });

    const win = screen.getByRole('dialog', { name: 'Outline' });
    expect(win).toHaveTextContent('Outline body');
    expect(within(rail('Left panels')).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Pages']);
    expect(last(onLayoutChange).floating.outline).toMatchObject({ home: 'left', homeIndex: 0 });

    fireEvent.click(within(win).getByRole('button', { name: 'Close Outline' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(rail('Left panels')).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Outline', 'Pages']);
    expect(screen.getByRole('tab', { name: 'Outline' })).toHaveAttribute('aria-selected', 'true');
  });

  it('a floating panel can be docked into any rail from its menu', () => {
    const { container } = setup();
    giveGeometry(container);
    fireEvent.click(screen.getByRole('button', { name: 'Move Outline' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Float' }));
    const win = screen.getByRole('dialog', { name: 'Outline' });
    fireEvent.click(within(win).getByRole('button', { name: 'Move Outline' }));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Dock to left rail',
      'Dock to right rail',
      'Dock to bottom rail',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dock to bottom rail' }));
    expect(within(rail('Bottom panels')).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Console', 'Outline']);
  });

  it('resizes the open panel from the keyboard and reports the size', () => {
    const { onLayoutChange } = setup();
    const handle = screen.getByRole('separator', { name: 'Resize Outline' });
    expect(handle).toHaveAttribute('aria-valuenow', '280');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(last(onLayoutChange).sizes.outline).toBe(296);
    expect(screen.getByRole('separator', { name: 'Resize Outline' })).toHaveAttribute('aria-valuenow', '296');
  });

  it('reports a drag resize once, on release', () => {
    const { onLayoutChange } = setup();
    const handle = screen.getByRole('separator', { name: 'Resize Outline' });
    fireEvent.pointerDown(handle, { button: 0, clientX: 310, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 330, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 360, clientY: 100 });
    expect(onLayoutChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { clientX: 360, clientY: 100 });
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    expect(last(onLayoutChange).sizes.outline).toBe(330);
  });

  it('starts from a stored layout, repairing what no longer fits', () => {
    setup({
      layout: {
        version: 1,
        rails: { right: { panels: ['outline', 'retired'], expanded: 'outline' } },
        floating: {},
        sizes: {},
      },
    });
    expect(within(rail('Right panels')).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Outline', 'Comments']);
    expect(within(rail('Left panels')).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Pages']);
    expect(screen.getByRole('tabpanel', { name: 'Outline' })).toBeVisible();
  });

  it('follows a controlled layout', () => {
    function Controlled() {
      // null, not undefined: a controlled caller with nothing stored yet (undefined means uncontrolled).
      const [layout, setLayout] = useState<RailLayout | null>(null);
      return (
        <>
          <button type="button" onClick={() => setLayout(null)}>reset</button>
          <PanelRail panels={panels()} sides={['left', 'right']} layout={layout} onLayoutChange={setLayout}>
            <main>doc</main>
          </PanelRail>
        </>
      );
    }
    render(<Controlled />);
    fireEvent.click(screen.getByRole('tab', { name: 'Comments' }));
    expect(screen.getByRole('tab', { name: 'Comments' })).toHaveAttribute('aria-selected', 'true');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    });
    expect(screen.getByRole('tab', { name: 'Comments' })).toHaveAttribute('aria-selected', 'false');
  });

  describe('at phone width', () => {
    function phone() {
      const original = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia;
      return () => {
        window.matchMedia = original;
      };
    }

    it('shows only the panel opened last, without closing the other in the stored layout', () => {
      const restore = phone();
      try {
        const { onLayoutChange } = setup();
        fireEvent.click(screen.getByRole('tab', { name: 'Comments' }));
        expect(screen.getByRole('tabpanel', { name: 'Comments' })).toBeVisible();
        expect(screen.queryByRole('tabpanel', { name: 'Outline' })).toBeNull();
        expect(last(onLayoutChange).rails.left!.expanded).toBe('outline');

        // Outline is still open in the layout: its tab brings it back rather than closing it.
        fireEvent.click(screen.getByRole('tab', { name: 'Outline' }));
        expect(screen.getByRole('tabpanel', { name: 'Outline' })).toBeVisible();
        expect(screen.queryByRole('tabpanel', { name: 'Comments' })).toBeNull();
        expect(last(onLayoutChange).rails.left!.expanded).toBe('outline');

        // Collapsing it leaves the view uncovered; it does not uncover Comments.
        fireEvent.click(screen.getByRole('tab', { name: 'Outline' }));
        expect(screen.queryByRole('tabpanel')).toBeNull();
        expect(last(onLayoutChange).rails.right!.expanded).toBe('comments');
      } finally {
        restore();
      }
    });

    it('on a fresh page, collapsing the panel showing does not uncover another rail’s', () => {
      const restore = phone();
      try {
        setup({ defaultExpanded: { left: 'outline', right: 'comments' } });
        expect(screen.getAllByRole('tabpanel').map((p) => p.getAttribute('aria-labelledby'))).toHaveLength(1);
        expect(screen.getByRole('tabpanel', { name: 'Outline' })).toBeVisible();
        fireEvent.click(screen.getByRole('tab', { name: 'Outline' }));
        expect(screen.queryByRole('tabpanel')).toBeNull();
        // Comments is still open in the layout; its tab shows it rather than closing it.
        fireEvent.click(screen.getByRole('tab', { name: 'Comments' }));
        expect(screen.getByRole('tabpanel', { name: 'Comments' })).toBeVisible();
      } finally {
        restore();
      }
    });

    it('offers no Float, since a floating window has no room', () => {
      const restore = phone();
      try {
        setup();
        fireEvent.click(screen.getByRole('button', { name: 'Move Outline' }));
        expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
          'Move to right rail',
          'Move to bottom rail',
        ]);
      } finally {
        restore();
      }
    });
  });
});
