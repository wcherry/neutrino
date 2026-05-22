/**
 * Unit tests for FileGrid keyboard activation.
 *
 * Covers:
 *   - Mouse click on a large-grid card calls onItemClick
 *   - Enter key on a focused large-grid card calls onItemClick
 *   - Space key on a focused large-grid card calls onItemClick
 *   - Mouse click on a small-grid card calls onItemClick
 *   - Enter key on a focused small-grid card calls onItemClick
 *   - Space key on a focused small-grid card calls onItemClick
 *   - Mouse click on a list-view row calls onItemClick
 *   - Enter key on a focused list-view row calls onItemClick
 *   - Space key on a focused list-view row calls onItemClick
 *   - Pressing Space on a card prevents default (no page scroll)
 *   - Other keys (e.g. Tab, ArrowDown) do not call onItemClick
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { Table2 } from 'lucide-react';

// ── CSS module mocks ──────────────────────────────────────────────────────────

vi.mock('../../../../packages/ui/src/components/display/FileGrid.module.css', () => ({
  default: new Proxy({}, { get: (_t, key) => String(key) }),
}));

// ── Neutrino UI mocks ─────────────────────────────────────────────────────────

vi.mock('@neutrino/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@neutrino/ui')>();
  return {
    ...actual,
    Card: ({
      children,
      onClick,
      onKeyDown,
      tabIndex,
      role,
      'aria-label': ariaLabel,
      className,
    }: {
      children: React.ReactNode;
      onClick?: React.MouseEventHandler<HTMLDivElement>;
      onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
      tabIndex?: number;
      role?: string;
      'aria-label'?: string;
      className?: string;
    }) => (
      <div
        data-testid="card"
        onClick={onClick}
        onKeyDown={onKeyDown}
        tabIndex={tabIndex}
        role={role}
        aria-label={ariaLabel}
        className={className}
      >
        {children}
      </div>
    ),
    Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    FileListSkeleton: () => <div data-testid="skeleton" />,
    Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  };
});

// ── Subject ───────────────────────────────────────────────────────────────────

import { FileGrid, type GridItem, type SortField, type SortDir } from '@neutrino/ui';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<GridItem> = {}): GridItem {
  return {
    id: 'sheet-1',
    name: 'My Spreadsheet',
    kind: 'doc',
    icon: Table2,
    iconColor: '#16a34a',
    subtitle: 'Jan 1, 2026',
    typeText: 'Sheet',
    modifiedText: 'Jan 1, 2026',
    ...overrides,
  };
}

function renderGrid(
  onItemClick: (item: GridItem) => void,
  defaultViewMode: 'large' | 'small' | 'list' = 'large',
) {
  const sortBy: SortField = 'updatedAt';
  const sortDir: SortDir = 'desc';
  return render(
    <FileGrid
      items={[makeItem()]}
      isLoading={false}
      isError={false}
      onItemClick={onItemClick}
      showFilter={false}
      showSizeColumn={false}
      sortBy={sortBy}
      sortDir={sortDir}
      onSortChange={vi.fn()}
      defaultViewMode={defaultViewMode}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('FileGrid — large-grid view', () => {
  it('calls onItemClick when a card is clicked', () => {
    const onItemClick = vi.fn();
    renderGrid(onItemClick, 'large');
    const card = screen.getByRole('listitem', { name: 'My Spreadsheet' });
    fireEvent.click(card);
    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'sheet-1' }));
  });

  it('calls onItemClick when Enter is pressed on a focused card', () => {
    const onItemClick = vi.fn();
    renderGrid(onItemClick, 'large');
    const card = screen.getByRole('listitem', { name: 'My Spreadsheet' });
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'sheet-1' }));
  });

  it('calls onItemClick when Space is pressed on a focused card', () => {
    const onItemClick = vi.fn();
    renderGrid(onItemClick, 'large');
    const card = screen.getByRole('listitem', { name: 'My Spreadsheet' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onItemClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onItemClick for other keys on a card', () => {
    const onItemClick = vi.fn();
    renderGrid(onItemClick, 'large');
    const card = screen.getByRole('listitem', { name: 'My Spreadsheet' });
    fireEvent.keyDown(card, { key: 'Tab' });
    fireEvent.keyDown(card, { key: 'ArrowDown' });
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(onItemClick).not.toHaveBeenCalled();
  });

  it('prevents default on Space to avoid page scroll', () => {
    const onItemClick = vi.fn();
    renderGrid(onItemClick, 'large');
    const card = screen.getByRole('listitem', { name: 'My Spreadsheet' });
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    card.dispatchEvent(event);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('FileGrid — small-grid view', () => {
  it('calls onItemClick when a card is clicked', () => {
    const onItemClick = vi.fn();
    renderGrid(onItemClick, 'small');
    const card = screen.getByRole('listitem', { name: 'My Spreadsheet' });
    fireEvent.click(card);
    expect(onItemClick).toHaveBeenCalledTimes(1);
  });

  it('calls onItemClick when Enter is pressed on a focused card', () => {
    const onItemClick = vi.fn();
    renderGrid(onItemClick, 'small');
    const card = screen.getByRole('listitem', { name: 'My Spreadsheet' });
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'sheet-1' }));
  });

  it('calls onItemClick when Space is pressed on a focused card', () => {
    const onItemClick = vi.fn();
    renderGrid(onItemClick, 'small');
    const card = screen.getByRole('listitem', { name: 'My Spreadsheet' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onItemClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onItemClick for other keys on a small card', () => {
    const onItemClick = vi.fn();
    renderGrid(onItemClick, 'small');
    const card = screen.getByRole('listitem', { name: 'My Spreadsheet' });
    fireEvent.keyDown(card, { key: 'Tab' });
    fireEvent.keyDown(card, { key: 'a' });
    expect(onItemClick).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('FileGrid — list view', () => {
  it('calls onItemClick when a list row is clicked', () => {
    const onItemClick = vi.fn();
    renderGrid(onItemClick, 'list');
    const row = screen.getByRole('listitem', { name: 'My Spreadsheet' });
    fireEvent.click(row);
    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'sheet-1' }));
  });

  it('calls onItemClick when Enter is pressed on a focused list row', () => {
    const onItemClick = vi.fn();
    renderGrid(onItemClick, 'list');
    const row = screen.getByRole('listitem', { name: 'My Spreadsheet' });
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'sheet-1' }));
  });

  it('calls onItemClick when Space is pressed on a focused list row', () => {
    const onItemClick = vi.fn();
    renderGrid(onItemClick, 'list');
    const row = screen.getByRole('listitem', { name: 'My Spreadsheet' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onItemClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onItemClick for other keys on a list row', () => {
    const onItemClick = vi.fn();
    renderGrid(onItemClick, 'list');
    const row = screen.getByRole('listitem', { name: 'My Spreadsheet' });
    fireEvent.keyDown(row, { key: 'ArrowDown' });
    fireEvent.keyDown(row, { key: 'Escape' });
    expect(onItemClick).not.toHaveBeenCalled();
  });
});
