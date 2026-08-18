/**
 * The Format menu's "Header & footer…" entry must not depend on a feature flag.
 *
 * It used to sit inside the `docsLayoutStructure` block alongside Watermark and
 * Document theme, so with that flag off the only discoverable way into headers
 * and footers simply was not in the menu. Watermark and theme stay flagged —
 * this pins only that the header/footer entry escaped that block.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

/** Every flag off — the state before the flags endpoint answers. */
const flags: Record<string, boolean> = {};

vi.mock('@/providers/FeatureFlagsProvider', () => ({
  useFeatureFlags: () => flags,
}));

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
  it('is in the Format menu with every flag off', () => {
    const onHeaderFooter = vi.fn();
    render(<HamburgerMenu editor={null} onHeaderFooter={onHeaderFooter} />);

    const entry = menu('Format').find(i => i.label === 'Header & footer…');
    expect(entry).toBeDefined();

    entry!.action!();
    expect(onHeaderFooter).toHaveBeenCalled();
  });

  it('still keeps watermark and theme behind the layout flag', () => {
    render(<HamburgerMenu editor={null} />);
    const labels = menu('Format').map(i => i.label);

    expect(labels).toContain('Header & footer…');
    expect(labels).not.toContain('Watermark…');
    expect(labels).not.toContain('Document theme…');
  });
});
