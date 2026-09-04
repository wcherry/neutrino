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
 *
 * Plus the type-filter chips, which group by what a file is rather than by
 * which app owns it (the sidebar already cuts it that way):
 *   - The chip set, and that each file falls under exactly one of them
 *   - A chip keeps only its own group
 *   - Folders survive every chip
 *   - The MIME grouping itself, including the cases where the hints overlap
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

import {
  FileGrid,
  categorizeMime,
  type GridItem,
  type SortField,
  type SortDir,
} from '@neutrino/ui';

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
describe('FileGrid — card meta line', () => {
  // A Saturday at midday; the cards below date themselves against it.
  const now = new Date(2024, 5, 15, 12, 0, 0);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderItem(item: GridItem, defaultViewMode: 'large' | 'list' = 'large') {
    return render(
      <FileGrid
        items={[item]}
        onItemClick={vi.fn()}
        sortBy={'updatedAt' as SortField}
        sortDir={'desc' as SortDir}
        onSortChange={vi.fn()}
        defaultViewMode={defaultViewMode}
      />,
    );
  }

  it('shows the last change as a friendly date on a large card', () => {
    renderItem(makeItem({
      subtitle: undefined,
      updatedAt: new Date(2024, 5, 14, 9, 0).toISOString(),
    }));
    expect(screen.getByText('Yesterday')).toBeTruthy();
  });

  it('shows the subtitle and the friendly date together', () => {
    renderItem(makeItem({
      subtitle: '4.2 MB',
      updatedAt: new Date(2024, 5, 15, 8, 0).toISOString(),
    }));
    expect(screen.getByText('4.2 MB')).toBeTruthy();
    expect(screen.getByText('4 hours ago')).toBeTruthy();
  });

  it('shows only the subtitle when the item carries no date', () => {
    renderItem(makeItem({ subtitle: 'Folder', updatedAt: undefined }));
    expect(screen.getByText('Folder')).toBeTruthy();
    expect(screen.queryByText(/ago$/)).toBeNull();
  });

  it('leaves the list view Modified column absolute', () => {
    renderItem(
      makeItem({
        modifiedText: 'Jun 14, 2024',
        updatedAt: new Date(2024, 5, 14, 9, 0).toISOString(),
      }),
      'list',
    );
    expect(screen.getByText('Jun 14, 2024')).toBeTruthy();
    expect(screen.queryByText('Yesterday')).toBeNull();
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

// ─────────────────────────────────────────────────────────────────────────────
describe('FileGrid — type filter', () => {
  const ITEMS: GridItem[] = [
    makeItem({ id: 'folder-1', name: 'Reports', kind: 'folder', mimeType: undefined }),
    makeItem({ id: 'photo-1', name: 'Beach.jpg', kind: 'file', mimeType: 'image/jpeg' }),
    makeItem({ id: 'clip-1', name: 'Surf.mp4', kind: 'file', mimeType: 'video/mp4' }),
    makeItem({ id: 'note-1', name: 'Groceries', kind: 'file', mimeType: 'application/x-neutrino-note' }),
    makeItem({ id: 'sheet-2', name: 'Budget', kind: 'file', mimeType: 'application/x-neutrino-sheet' }),
    makeItem({ id: 'diagram-1', name: 'Architecture', kind: 'file', mimeType: 'application/x-neutrino-diagram' }),
    makeItem({ id: 'pdf-1', name: 'Invoice.pdf', kind: 'file', mimeType: 'application/pdf' }),
    makeItem({ id: 'zip-1', name: 'backup.zip', kind: 'file', mimeType: 'application/zip' }),
  ];

  function renderFilterable(props: Partial<React.ComponentProps<typeof FileGrid>> = {}) {
    return render(
      <FileGrid
        items={ITEMS}
        isLoading={false}
        isError={false}
        onItemClick={vi.fn()}
        showFilter
        showSizeColumn={false}
        sortBy={'updatedAt' as SortField}
        sortDir={'desc' as SortDir}
        onSortChange={vi.fn()}
        defaultViewMode="large"
        {...props}
      />,
    );
  }

  function visibleNames(): string[] {
    return screen.getAllByRole('listitem').map((el) => el.getAttribute('aria-label') ?? '');
  }

  it('offers one chip per group rather than one per app', () => {
    renderFilterable();
    const chips = screen
      .getByRole('group', { name: 'Filter files' })
      .querySelectorAll('button');
    expect([...chips].map((c) => c.textContent)).toEqual([
      'All', 'Media', 'Office', 'Drawings', 'PDFs', 'Archives', 'Code', 'Starred',
    ]);
  });

  it('gathers pictures and clips under one chip', () => {
    renderFilterable();
    fireEvent.click(screen.getByRole('button', { name: 'Media' }));
    expect(visibleNames()).toEqual(['Reports', 'Beach.jpg', 'Surf.mp4']);
  });

  it('gathers the office suite under one chip and the canvas apps under another', () => {
    renderFilterable();
    fireEvent.click(screen.getByRole('button', { name: 'Office' }));
    expect(visibleNames()).toEqual(['Reports', 'Groceries', 'Budget']);

    fireEvent.click(screen.getByRole('button', { name: 'Drawings' }));
    expect(visibleNames()).toEqual(['Reports', 'Architecture']);
  });

  it('gives the loose types the sidebar has no entry for their own chips', () => {
    renderFilterable();
    fireEvent.click(screen.getByRole('button', { name: 'PDFs' }));
    expect(visibleNames()).toEqual(['Reports', 'Invoice.pdf']);

    fireEvent.click(screen.getByRole('button', { name: 'Archives' }));
    expect(visibleNames()).toEqual(['Reports', 'backup.zip']);
  });

  it('reports the chip to a controlled owner without moving itself', () => {
    // How My Drive answers the filter from the server: the page owns the chip,
    // refetches with `?type=`, and passes the new one back down.
    const onFilterChange = vi.fn();
    renderFilterable({ filter: 'all', onFilterChange });
    fireEvent.click(screen.getByRole('button', { name: 'Drawings' }));
    // The chip key is the backend's category name, sent as `?type=` verbatim.
    expect(onFilterChange).toHaveBeenCalledWith('canvas');
    expect(visibleNames()).toHaveLength(ITEMS.length);
  });

  it('files every item under exactly one chip', () => {
    renderFilterable();
    const chips = ['Media', 'Office', 'Drawings', 'PDFs', 'Archives', 'Code'];
    const seen = chips.flatMap((chip) => {
      fireEvent.click(screen.getByRole('button', { name: chip }));
      // The folder is in every listing by design, so it is not counted here.
      return visibleNames().filter((n) => n !== 'Reports');
    });
    expect([...seen].sort()).toEqual(
      ITEMS.filter((i) => i.kind !== 'folder').map((i) => i.name).sort(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('categorizeMime', () => {
  it('puts pictures, clips and sound together', () => {
    expect(categorizeMime('image/png')).toBe('media');
    expect(categorizeMime('video/quicktime')).toBe('media');
    expect(categorizeMime('audio/mpeg')).toBe('media');
    expect(categorizeMime('image/svg+xml')).toBe('media');
  });

  it('puts Neutrino documents beside their uploaded equivalents', () => {
    expect(categorizeMime('application/x-neutrino-doc')).toBe('office');
    expect(categorizeMime('application/x-neutrino-sheet')).toBe('office');
    expect(categorizeMime('application/x-neutrino-slide')).toBe('office');
    expect(categorizeMime('application/x-neutrino-note')).toBe('office');
    expect(categorizeMime('application/msword')).toBe('office');
    expect(categorizeMime('application/vnd.oasis.opendocument.text')).toBe('office');
    expect(categorizeMime('text/csv')).toBe('office');
  });

  // "openxmlformats" contains "xml", so an office check that ran after the code
  // one would file every .docx and .xlsx under Code.
  it('keeps an Office XML file out of Code', () => {
    expect(categorizeMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('office');
    expect(categorizeMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('office');
    expect(categorizeMime('application/xml')).toBe('code');
  });

  it('puts diagrams and drawings together', () => {
    // `canvas`, not `drawing`: the backend already uses `drawing` for the
    // drawing app alone, and the chip keys are sent to it verbatim.
    expect(categorizeMime('application/x-neutrino-diagram')).toBe('canvas');
    expect(categorizeMime('application/x-neutrino-drawing')).toBe('canvas');
  });

  it('recognises the loose types under any of their spellings', () => {
    expect(categorizeMime('application/pdf')).toBe('pdf');
    expect(categorizeMime('application/zip')).toBe('archive');
    expect(categorizeMime('application/x-zip-compressed')).toBe('archive');
    expect(categorizeMime('application/x-7z-compressed')).toBe('archive');
    expect(categorizeMime('text/javascript')).toBe('code');
    expect(categorizeMime('application/json')).toBe('code');
    expect(categorizeMime('text/html')).toBe('code');
  });

  it('leaves anything it does not recognise out of every chip', () => {
    expect(categorizeMime('application/octet-stream')).toBe('other');
    expect(categorizeMime('')).toBe('other');
  });
});
