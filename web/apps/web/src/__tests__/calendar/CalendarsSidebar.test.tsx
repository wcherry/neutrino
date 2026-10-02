/**
 * The calendar list in the calendar sidebar: show/hide, colour, add and delete.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import type { CalendarResponse } from '@neutrino/api-calendar';
import { CalendarsSidebar } from '../../app/(apps)/calendar/CalendarsSidebar';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('@neutrino/ui', () => ({
  AlertDialog: ({ open, title, onConfirm, onClose, confirmLabel }: {
    open: boolean; title: string; onConfirm?: () => void; onClose: () => void; confirmLabel?: string;
  }) =>
    open ? (
      <div role="alertdialog" aria-label={title}>
        <button onClick={onConfirm}>{confirmLabel}</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    ) : null,
}));

function calendar(overrides: Partial<CalendarResponse>): CalendarResponse {
  return {
    id: 'cal',
    name: 'Calendar',
    color: '#3b82f6',
    visible: true,
    readOnly: false,
    kind: 'local',
    isDefault: false,
    source: null,
    country: null,
    region: null,
    includeObservances: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const calendars = [
  calendar({ id: 'default', name: 'Calendar', isDefault: true }),
  calendar({ id: 'work', name: 'Work', color: '#16a34a', visible: false }),
  calendar({ id: 'us', name: 'United States', kind: 'holidays', readOnly: true, country: 'US' }),
];

function renderSidebar(overrides: Partial<React.ComponentProps<typeof CalendarsSidebar>> = {}) {
  const props = {
    calendars,
    onToggle: vi.fn(),
    onRecolor: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<CalendarsSidebar {...props} />);
  return props;
}

describe('CalendarsSidebar', () => {
  it('lists every calendar with its visibility', () => {
    renderSidebar();
    expect(screen.getAllByTestId('calendar-row')).toHaveLength(3);
    expect(screen.getByLabelText('Show Calendar')).toBeChecked();
    expect(screen.getByLabelText('Show Work')).not.toBeChecked();
  });

  it('shows and hides a calendar', () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByLabelText('Show Work'));
    expect(props.onToggle).toHaveBeenCalledWith('work', true);
    fireEvent.click(screen.getByLabelText('Show Calendar'));
    expect(props.onToggle).toHaveBeenCalledWith('default', false);
  });

  it('marks a read-only calendar', () => {
    renderSidebar();
    const row = screen.getAllByTestId('calendar-row').find((r) => r.dataset.calendarId === 'us')!;
    expect(within(row).getByLabelText('Read-only')).toBeInTheDocument();
  });

  it('recolours a calendar', () => {
    const props = renderSidebar();
    fireEvent.change(screen.getByLabelText('Colour of Work'), { target: { value: '#112233' } });
    expect(props.onRecolor).toHaveBeenCalledWith('work', '#112233');
  });

  it('offers no delete for the default calendar', () => {
    renderSidebar();
    expect(screen.queryByLabelText('Delete Calendar')).toBeNull();
    expect(screen.getByLabelText('Delete Work')).toBeInTheDocument();
  });

  it('deletes a calendar only once confirmed', () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByLabelText('Delete Work'));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Work?' });
    fireEvent.click(within(dialog).getByText('Cancel'));
    expect(props.onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Delete Work'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Delete'));
    expect(props.onDelete).toHaveBeenCalledWith('work');
  });

  it('adds a calendar with a name and colour', () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByLabelText('New calendar'));
    fireEvent.change(screen.getByLabelText('Calendar name'), { target: { value: '  Family ' } });
    fireEvent.click(screen.getByRole('radio', { name: '#e11d48' }));
    fireEvent.click(screen.getByText('Add'));
    expect(props.onCreate).toHaveBeenCalledWith('Family', '#e11d48');
  });

  it('shows why a change failed', () => {
    renderSidebar({ error: 'This calendar is read-only' });
    expect(screen.getByRole('alert')).toHaveTextContent('This calendar is read-only');
  });
});
