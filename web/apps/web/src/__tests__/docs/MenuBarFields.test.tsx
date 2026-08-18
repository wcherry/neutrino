/**
 * The field-code entries in the menu.
 *
 * They sit outside every feature-flag block, so this renders with no flags at
 * all — the state before the flags endpoint answers. A field code typed into a
 * document resolves whatever the flags say, and a menu that only offers to
 * refresh it under a flag would leave a document showing stale values with no
 * way to say so.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

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
  shortcut?: string;
  items?: Item[];
  action?: () => void;
};

let captured: Item[] = [];

vi.mock('@neutrino/ui', () => ({
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

function menu(label: string, within: Item[] = captured): Item[] {
  const found = within.find(i => i.label === label);
  if (!found?.items) throw new Error(`no ${label} menu`);
  return found.items;
}

function entry(label: string, within: Item[]): Item {
  const found = within.find(i => i.label === label);
  if (!found) throw new Error(`no ${label} entry`);
  return found;
}

beforeEach(() => {
  captured = [];
});

describe('MenuBar — field codes', () => {
  it('offers every built-in code under Insert → Field', () => {
    render(<HamburgerMenu editor={null} />);
    const labels = menu('Field', menu('Insert')).map(i => i.label);

    for (const label of ['Title', 'Page number', 'Page count', 'Date', 'Author']) {
      expect(labels).toContain(label);
    }
  });

  it('wires refresh, the code/value switch and the fallback dialog', () => {
    const onRefreshFields = vi.fn();
    const onToggleFieldCodes = vi.fn();
    const onInsertFieldDialog = vi.fn();
    render(
      <HamburgerMenu
        editor={null}
        onRefreshFields={onRefreshFields}
        onToggleFieldCodes={onToggleFieldCodes}
        onInsertFieldDialog={onInsertFieldDialog}
      />,
    );
    const field = menu('Field', menu('Insert'));

    entry('Refresh all fields', field).action?.();
    expect(onRefreshFields).toHaveBeenCalled();
    expect(entry('Refresh all fields', field).shortcut).toBe('F9');

    entry('Show field codes', field).action?.();
    expect(onToggleFieldCodes).toHaveBeenCalled();

    entry('Field with fallback…', field).action?.();
    expect(onInsertFieldDialog).toHaveBeenCalled();
  });

  it('ticks the code/value switch when codes are showing', () => {
    render(<HamburgerMenu editor={null} showFieldCodes />);
    const labels = menu('Field', menu('Insert')).map(i => i.label);
    expect(labels).toContain('Show field codes ✓');
  });

  it('puts Document properties in the File menu', () => {
    const onDocProperties = vi.fn();
    render(<HamburgerMenu editor={null} onDocProperties={onDocProperties} />);

    entry('Document properties…', menu('File')).action?.();
    expect(onDocProperties).toHaveBeenCalled();
  });
});
