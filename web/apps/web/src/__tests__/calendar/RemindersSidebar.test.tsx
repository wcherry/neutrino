/**
 * Tests for RemindersSidebar — chiefly the Today / 3 days / 7 days / All
 * filter and how it composes with the search box that was already there.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { RemindersSidebar } from '../../app/(apps)/calendar/RemindersSidebar';
import type { ReminderResponse } from '../../lib/api';

vi.mock('../../lib/api', () => ({ calendarApi: {} }));

// A Wednesday afternoon, so "end of today" is not "now".
const NOW = new Date('2026-09-23T15:30:00');

function reminder(
  overrides: Partial<ReminderResponse> & { id: string; title: string; dueTime: string }
): ReminderResponse {
  return {
    completed: false,
    recurrenceRule: null,
    linkedEventId: null,
    linkedTaskId: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

const overdue = reminder({ id: 'r0', title: 'Overdue one', dueTime: '2026-09-21T09:00:00' });
const todayR = reminder({ id: 'r1', title: 'Today one', dueTime: '2026-09-23T18:00:00' });
const tomorrow = reminder({ id: 'r2', title: 'Tomorrow one', dueTime: '2026-09-24T09:00:00' });
const inFiveDays = reminder({ id: 'r3', title: 'Five days out', dueTime: '2026-09-27T09:00:00' });
const nextMonth = reminder({ id: 'r4', title: 'Next month', dueTime: '2026-10-20T09:00:00' });

const ALL = [overdue, todayR, tomorrow, inFiveDays, nextMonth];

function renderSidebar(reminders: ReminderResponse[] = ALL) {
  const props = {
    reminders,
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onNew: vi.fn(),
  };
  render(<RemindersSidebar {...props} />);
  return props;
}

const pick = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }));
const shown = (title: string) => screen.queryByText(title) !== null;

describe('RemindersSidebar range filter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('offers the four ranges', () => {
    renderSidebar();
    for (const label of ['Today', '3 days', '7 days', 'All']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined();
    }
  });

  it('shows everything by default rather than starting filtered', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    expect(ALL.every((r) => shown(r.title))).toBe(true);
  });

  it('narrows to the end of today', () => {
    renderSidebar();
    pick('Today');
    expect(shown('Today one')).toBe(true);
    expect(shown('Tomorrow one')).toBe(false);
    expect(shown('Five days out')).toBe(false);
    expect(shown('Next month')).toBe(false);
  });

  it('counts today as the first of the three days', () => {
    renderSidebar();
    pick('3 days');
    expect(shown('Tomorrow one')).toBe(true);
    expect(shown('Five days out')).toBe(false);
  });

  it('reaches a week out', () => {
    renderSidebar();
    pick('7 days');
    expect(shown('Five days out')).toBe(true);
    expect(shown('Next month')).toBe(false);
  });

  it('never hides an overdue reminder, whichever range is picked', () => {
    renderSidebar();
    for (const label of ['Today', '3 days', '7 days', 'All']) {
      pick(label);
      expect(shown('Overdue one')).toBe(true);
    }
  });

  it('filters completed reminders by the same range', () => {
    renderSidebar([
      reminder({ id: 'd1', title: 'Done today', dueTime: '2026-09-23T10:00:00', completed: true }),
      reminder({ id: 'd2', title: 'Done next month', dueTime: '2026-10-20T10:00:00', completed: true }),
    ]);
    pick('Today');
    expect(shown('Done today')).toBe(true);
    expect(shown('Done next month')).toBe(false);
  });

  it('says how many the range is holding back instead of reading as empty', () => {
    renderSidebar([nextMonth, inFiveDays]);
    pick('Today');
    expect(screen.getByText('Nothing due — 2 later reminders')).toBeDefined();
  });

  it('says "reminder" when only one is held back', () => {
    renderSidebar([nextMonth]);
    pick('Today');
    expect(screen.getByText('Nothing due — 1 later reminder')).toBeDefined();
  });

  it('still says "No reminders" when there are none at all', () => {
    renderSidebar([]);
    pick('Today');
    expect(screen.getByText('No reminders')).toBeDefined();
  });

  it('composes with the search box, and search wins the empty message', () => {
    renderSidebar();
    pick('7 days');
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'tomorrow' } });
    expect(shown('Tomorrow one')).toBe(true);
    expect(shown('Five days out')).toBe(false);

    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'next month' } });
    expect(screen.getByText('No matches')).toBeDefined();
  });
});
