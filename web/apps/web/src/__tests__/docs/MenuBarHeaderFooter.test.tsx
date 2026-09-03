/**
 * The Format menu carries "Header & footer…" and its layout siblings.
 *
 * The entry used to sit inside a `docsLayoutStructure` block alongside
 * Watermark and Document theme, and with that flag off the only discoverable
 * way into headers and footers was not in the menu at all. The flag is gone and
 * the whole block is unconditional now, so these pin the entries themselves.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

type Item = {
  kind: string;
  label?: string;
  items?: Item[];
  action?: () => void;
};

let captured: Item[] = [];

vi.mock('@neutrino/ui', () => ({
  // Capture the menu tree instead of rendering it: the assertion is about what
  // is in the model, not how the shared menu component paints it.
  HamburgerMenu: ({ items }: { items: Item[] }) => {
    captured = items;
    return null;
  },
  HamburgerMenuItem: {},
  Modal: () => null,
  ModalHeader: () => null,
  ModalBody: () => null,
}));

import { HamburgerMenu } from '../../app/(apps)/docs/editor/MenuBar';

function menu(label: string): Item[] {
  const found = captured.find(i => i.label === label);
  if (!found?.items) throw new Error(`no ${label} menu`);
  return found.items;
}

describe('MenuBar — Header & footer entry', () => {
  it('is in the Format menu, and calls back when chosen', () => {
    const onHeaderFooter = vi.fn();
    render(<HamburgerMenu editor={null} onHeaderFooter={onHeaderFooter} />);

    const entry = menu('Format').find(i => i.label === 'Header & footer…');
    expect(entry).toBeDefined();

    entry!.action!();
    expect(onHeaderFooter).toHaveBeenCalled();
  });

  it('carries watermark and theme alongside it', () => {
    render(<HamburgerMenu editor={null} />);
    const labels = menu('Format').map(i => i.label);

    expect(labels).toContain('Header & footer…');
    expect(labels).toContain('Watermark…');
    expect(labels).toContain('Document theme…');
  });
});
