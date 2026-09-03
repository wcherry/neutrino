/**
 * Tests for MonthView's event bars — issue #130.
 *
 * A multi-day event is drawn as one bar covering its days, cut at the week row's
 * edge and picked up again on the next row, rather than as a chip on the day it
 * happens to start on.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import MonthView from '../../app/(apps)/calendar/MonthView';
import type { EventResponse } from '../../lib/api';

// March 2026 starts on a Sunday, so with a Sunday week start the first row is
// the 1st–7th and no leading days of February appear in it.
const CURSOR = new Date(2026, 2, 15);

function makeEvent(overrides: Partial<EventResponse> & { id: string; title: string; startTime: string; endTime: string }): EventResponse {
  return {
    description: null,
    allDay: false,
    location: null,
    recurrenceRule: null,
    attendees: [],
    source: 'local',
    timezone: null,
    createdAt: overrides.startTime,
    updatedAt: overrides.startTime,
    ...overrides,
  };
}

function allDayEvent(id: string, title: string, firstDay: string, lastDay: string): EventResponse {
  return makeEvent({
    id,
    title,
    startTime: `${firstDay}T00:00:00Z`,
    endTime: `${lastDay}T23:59:59Z`,
    allDay: true,
  });
}

function renderMonth(events: EventResponse[], onEventClick = vi.fn(), onDayClick = vi.fn()) {
  const view = render(
    <MonthView
      cursor={CURSOR}
      events={events}
      onDayClick={onDayClick}
      onEventClick={onEventClick}
      startDay={0}
    />
  );
  return { ...view, onEventClick, onDayClick };
}

function bars(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="event-bar"]'));
}

describe('MonthView event bars', () => {
  it('draws a multi-day event as a single bar covering its days', () => {
    const { container } = renderMonth([allDayEvent('a', 'Conference', '2026-03-10', '2026-03-12')]);

    const drawn = bars(container);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toHaveAttribute('data-event-span', '3');
    expect(drawn[0]).toHaveAttribute('data-event-start-date', '2026-03-10');
    expect(drawn[0]).toHaveTextContent('Conference');
  });

  it('sizes the bar to span three of the row\'s seven columns', () => {
    const { container } = renderMonth([allDayEvent('a', 'Conference', '2026-03-10', '2026-03-12')]);
    // Tuesday is column 2 of 7, and the run is three columns wide. The px terms
    // are the inset that keeps the bar off its cells' edges.
    const percentOf = (value: string) => Number(/([\d.]+)%/.exec(value)![1]);
    expect(percentOf(bars(container)[0].style.left)).toBeCloseTo((2 / 7) * 100, 3);
    expect(percentOf(bars(container)[0].style.width)).toBeCloseTo((3 / 7) * 100, 3);
  });

  it('draws a single-day event as a one-column bar', () => {
    const { container } = renderMonth([allDayEvent('a', 'Holiday', '2026-03-10', '2026-03-10')]);
    expect(bars(container)[0]).toHaveAttribute('data-event-span', '1');
  });

  it('splits an event that crosses a week boundary into one bar per row', () => {
    // Friday the 13th to Monday the 16th — over the Saturday/Sunday break.
    const { container } = renderMonth([allDayEvent('a', 'Long weekend', '2026-03-13', '2026-03-16')]);

    const drawn = bars(container);
    expect(drawn).toHaveLength(2);
    expect(drawn.map((b) => b.getAttribute('data-event-start-date'))).toEqual([
      '2026-03-13', '2026-03-15',
    ]);
    expect(drawn.map((b) => b.getAttribute('data-event-span'))).toEqual(['2', '2']);
  });

  it('calls onEventClick with the event when a bar is clicked', () => {
    const event = allDayEvent('a', 'Conference', '2026-03-10', '2026-03-12');
    const { container, onEventClick, onDayClick } = renderMonth([event]);

    fireEvent.click(bars(container)[0]);

    expect(onEventClick).toHaveBeenCalledWith(event);
    // The bar sits over a day cell; clicking it must not also open the new-event
    // modal for that day.
    expect(onDayClick).not.toHaveBeenCalled();
  });

  it('still opens the day when an empty part of a cell is clicked', () => {
    const { onDayClick } = renderMonth([allDayEvent('a', 'Conference', '2026-03-10', '2026-03-12')]);

    fireEvent.click(document.querySelector('[data-date="2026-03-11"]')!);

    expect(onDayClick).toHaveBeenCalledOnce();
    expect((onDayClick.mock.calls[0][0] as Date).getDate()).toBe(11);
  });

  it('shows a timed event\'s start time on the bar', () => {
    const { container } = renderMonth([
      makeEvent({
        id: 't', title: 'Standup',
        startTime: new Date(2026, 2, 10, 9, 0).toISOString(),
        endTime: new Date(2026, 2, 10, 9, 30).toISOString(),
      }),
    ]);
    expect(bars(container)[0].textContent).toMatch(/9:00.*Standup/);
  });

  it('collapses a fourth overlapping event into "+1 more" on the days it covers', () => {
    const { container } = renderMonth([
      allDayEvent('a', 'One', '2026-03-10', '2026-03-10'),
      allDayEvent('b', 'Two', '2026-03-10', '2026-03-10'),
      allDayEvent('c', 'Three', '2026-03-10', '2026-03-10'),
      allDayEvent('d', 'Four', '2026-03-10', '2026-03-10'),
    ]);

    expect(bars(container)).toHaveLength(3);
    const cell = document.querySelector<HTMLElement>('[data-date="2026-03-10"]')!;
    expect(within(cell).getByText('+1 more')).toBeInTheDocument();
    // The overflow belongs to the day it covers, not to its neighbours.
    const other = document.querySelector<HTMLElement>('[data-date="2026-03-11"]')!;
    expect(within(other).queryByText(/more/)).not.toBeInTheDocument();
  });

  it('renders no bars for a month with no events', () => {
    const { container } = renderMonth([]);
    expect(bars(container)).toHaveLength(0);
    expect(screen.getAllByTestId('day-cell').length).toBeGreaterThan(27);
  });
});
