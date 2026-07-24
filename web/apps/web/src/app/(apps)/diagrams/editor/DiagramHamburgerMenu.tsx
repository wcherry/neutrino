'use client';

import { HamburgerMenu, type HamburgerMenuItem } from '@neutrino/ui';

interface DiagramHamburgerMenuProps {
  onNew: () => void;
  onSave: () => void;
  onDuplicate: () => void;
  onDeleteClick: () => void;
}

export function DiagramHamburgerMenu({ onNew, onSave, onDuplicate, onDeleteClick }: DiagramHamburgerMenuProps) {
  const items: HamburgerMenuItem[] = [
    { kind: 'action', label: 'New diagram', action: onNew },
    { kind: 'action', label: 'Save', shortcut: '⌘S', action: onSave },
    { kind: 'action', label: 'Duplicate', action: onDuplicate },
    { kind: 'separator' },
    { kind: 'action', label: 'Delete', danger: true, action: onDeleteClick },
  ];

  return <HamburgerMenu items={items} />;
}
