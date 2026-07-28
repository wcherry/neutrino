/**
 * Unit tests for ThemeContextMenu — modeled directly on Drive's
 * FileContextMenu (there is no FileContextMenu.test.tsx in this repo to
 * mirror, so this file exists to cover the small amount of item-building
 * logic that isn't already exercised through ThemeGrid.test.tsx: the
 * optional-prop-driven items array and separator placement.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { ThemeContextMenu } from '@/components/theme/ThemeContextMenu';

describe('ThemeContextMenu', () => {
  it('renders only Duplicate when no onEdit/onMakePublic/onDelete are passed', () => {
    render(<ThemeContextMenu x={0} y={0} onClose={vi.fn()} onDuplicate={vi.fn()} />);
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Duplicate');
  });

  it('renders Edit then Duplicate when only onEdit is passed', () => {
    render(<ThemeContextMenu x={0} y={0} onClose={vi.fn()} onDuplicate={vi.fn()} onEdit={vi.fn()} />);
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Edit');
    expect(items[1]).toHaveTextContent('Duplicate');
  });

  it('renders Duplicate then Make public when onMakePublic is passed but not onEdit/onDelete', () => {
    render(<ThemeContextMenu x={0} y={0} onClose={vi.fn()} onDuplicate={vi.fn()} onMakePublic={vi.fn()} />);
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Duplicate');
    expect(items[1]).toHaveTextContent('Make public');
  });

  it('renders Edit, Duplicate, Make public, a separator, then Delete when all optional props are passed', () => {
    render(
      <ThemeContextMenu
        x={0}
        y={0}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        onEdit={vi.fn()}
        onMakePublic={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Edit');
    expect(items[1]).toHaveTextContent('Duplicate');
    expect(items[2]).toHaveTextContent('Make public');
    expect(items[3]).toHaveTextContent('Delete');
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('renders no separator when there is nothing to separate (Duplicate only)', () => {
    render(<ThemeContextMenu x={0} y={0} onClose={vi.fn()} onDuplicate={vi.fn()} />);
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('the Delete item is styled danger', () => {
    render(<ThemeContextMenu x={0} y={0} onClose={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />);
    const deleteItem = screen.getByRole('menuitem', { name: 'Delete' });
    // CSS module class names are hashed at build/test time; assert the
    // element got *some* class beyond the base `.item` (i.e. `.danger` was
    // appended) rather than asserting an exact class string.
    expect(deleteItem.className.split(' ').length).toBeGreaterThan(1);
  });

  it('clicking an item calls its action and then onClose', async () => {
    const onDuplicate = vi.fn();
    const onClose = vi.fn();
    render(<ThemeContextMenu x={0} y={0} onClose={onClose} onDuplicate={onDuplicate} />);

    await userEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));

    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking Edit calls onEdit and then onClose', async () => {
    const onEdit = vi.fn();
    const onClose = vi.fn();
    render(<ThemeContextMenu x={0} y={0} onClose={onClose} onDuplicate={vi.fn()} onEdit={onEdit} />);

    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on outside mousedown', async () => {
    const onClose = vi.fn();
    render(
      <div>
        <div data-testid="outside">outside</div>
        <ThemeContextMenu x={0} y={0} onClose={onClose} onDuplicate={vi.fn()} />
      </div>
    );

    await userEvent.click(screen.getByTestId('outside'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape', async () => {
    const onClose = vi.fn();
    render(<ThemeContextMenu x={0} y={0} onClose={onClose} onDuplicate={vi.fn()} />);

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders with role="menu"', () => {
    render(<ThemeContextMenu x={0} y={0} onClose={vi.fn()} onDuplicate={vi.fn()} />);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
