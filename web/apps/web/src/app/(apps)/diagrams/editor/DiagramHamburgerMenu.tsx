'use client';

import { HamburgerMenu, type HamburgerMenuItem } from '@neutrino/ui';
import type { DiagramFormat } from '@neutrino/api-diagrams';

interface DiagramHamburgerMenuProps {
  onNew: () => void;
  onSave: () => void;
  /**
   * The format the open file is stored in, so Save can say which one it is
   * writing — "Save" on a `.svg` and "Save" on a `.json` do different things to
   * the file on disk, and the menu is where that is visible.
   */
  format: DiagramFormat;
  onSaveAs: (format: DiagramFormat) => void;
  onDuplicate: () => void;
  onDeleteClick: () => void;
}

const FORMAT_LABEL: Record<DiagramFormat, string> = {
  diagram: 'Neutrino diagram',
  svg: 'SVG',
};

export function DiagramHamburgerMenu({
  onNew,
  onSave,
  format,
  onSaveAs,
  onDuplicate,
  onDeleteClick,
}: DiagramHamburgerMenuProps) {
  const items: HamburgerMenuItem[] = [
    { kind: 'action', label: 'New diagram', action: onNew },
    { kind: 'action', label: `Save as ${FORMAT_LABEL[format]}`, shortcut: '⌘S', action: onSave },
    { kind: 'separator' },
    {
      kind: 'action',
      label: 'Save a copy as Neutrino diagram…',
      action: () => onSaveAs('diagram'),
    },
    { kind: 'action', label: 'Save a copy as SVG…', action: () => onSaveAs('svg') },
    { kind: 'action', label: 'Duplicate', action: onDuplicate },
    { kind: 'separator' },
    { kind: 'action', label: 'Delete', danger: true, action: onDeleteClick },
  ];

  return <HamburgerMenu items={items} />;
}
