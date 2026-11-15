/**
 * A folder can be shared from its menu — the only way into a folder's Share dialog, which is where
 * people are added and folder links (#321) are made. It shipped without one.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@neutrino/commands', () => ({ useDismiss: () => {} }));
vi.mock('@neutrino/preferences', () => ({ usePreference: () => [undefined, vi.fn()] }));
vi.mock('@/lib/sidebarLayout', () => ({
  MAX_PINS: 8,
  pinFolder: vi.fn(),
  unpinFolder: vi.fn(),
  readLayout: () => ({ pinned: [] }),
}));

import { FolderContextMenu } from '@/app/(apps)/drive/FolderContextMenu';

const folder = {
  id: 'f1',
  name: 'Shared stuff',
  parentId: null,
  color: null,
  isStarred: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function renderMenu(onShare = vi.fn(), onClose = vi.fn()) {
  render(
    <FolderContextMenu
      folder={folder}
      x={0}
      y={0}
      onClose={onClose}
      onRename={vi.fn()}
      onStarToggle={vi.fn()}
      onMove={vi.fn()}
      onDelete={vi.fn()}
      onShare={onShare}
    />,
  );
  return { onShare, onClose };
}

describe('FolderContextMenu', () => {
  it('offers Share first, as the file menu does', () => {
    renderMenu();
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(items[0]).toBe('Share');
  });

  it('opens sharing and closes the menu', () => {
    const { onShare, onClose } = renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Share' }));
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });
});
