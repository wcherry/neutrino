/**
 * Tests for the new hour-grid WeekView component.
 *
 * Covers:
 *  - Renders 7 day column headers for the week
 *  - Renders a full 24-hour gutter, dimming hours outside the day window
 *  - A timed event inside the visible window renders in the correct column
 *  - An event scrolled above the viewport raises the early-overflow chip (↑)
 *  - An event below the viewport raises the late-overflow chip (↓)
 *  - An all-day event renders in the all-day band
 *  - Clicking an event chip calls onEventClick
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import WeekView from '../../app/(apps)/calendar/WeekView';
import type { EventResponse } from '../../lib/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<EventResponse> & { id: string; title: string; startTime: string; endTime: string }): EventResponse {
  return {
    description: null,
    allDay: false,
    location: null,
    recurrenceRule: null,
    attendees: [],
    source: 'local',
    createdAt: overrides.startTime,
    updatedAt: overrides.startTime,
    timezone: null,
    ...overrides,
  };
}

// June 10 2025 is a Tuesday; cursor placed there so the week includes it
const CURSOR = new Date(2025, 5, 10); // June 10, 2025

function localIso(year: number, month: number, date: number, hour: number, minute = 0): string {
  return new Date(year, month - 1, date, hour, minute).toISOString();
}

/**
 * The overflow indicators are driven by the scroll position of the timed area
 * against its own height. jsdom does no layout, so `clientHeight` has to be
 * supplied before scrolling for the component to see a viewport at all.
 */
function scrollTimedArea(
  container: HTMLElement,
  { viewportHeight, scrollTop }: { viewportHeight: number; scrollTop: number },
) {
  const area = container.querySelector('[class*="scrollArea"]') as HTMLElement;
  Object.defineProperty(area, 'clientHeight', { value: viewportHeight, configurable: true });
  fireEvent.scroll(area, { target: { scrollTop } });
  return area;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WeekView (hour-grid)', () => {
  const defaultProps = {
    cursor: CURSOR,
    events: [],
    onDayClick: vi.fn(),
    onEventClick: vi.fn(),
    startDay: 0, // week starts Sunday
    dayStartHour: 8,
    dayEndHour: 20,
  };

  it('renders 7 day column headers', () => {
    render(<WeekView {...defaultProps} />);
    // The week containing June 10 (Tuesday), starting Sunday = June 8 through June 14
    // Use getAllByText to tolerate multiple matches (e.g. "8" and "8 AM")
    const items8 = screen.getAllByText(/\b8\b/);
    expect(items8.length).toBeGreaterThanOrEqual(1);
    // Day 14 header
    expect(screen.getAllByText(/\b14\b/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders a full 24-hour gutter, dimming the hours outside the day window', () => {
    const { container } = render(<WeekView {...defaultProps} />);
    // The grid is a scrollable 24-hour day, so every hour has a label…
    expect(screen.getAllByText(/8\s*AM/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/7\s*PM/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/7\s*AM/i).length).toBeGreaterThanOrEqual(1);

    // …and the hours outside [dayStartHour, dayEndHour) are dimmed instead of
    // omitted: 12 such hours (00–07, 20–23) across 7 day columns.
    const dimmed = container.querySelectorAll('[class*="hourSlotDimmed"]');
    expect(dimmed.length).toBe(12 * 7);
  });

  it('renders a timed event in the correct column', () => {
    const event = makeEvent({
      id: 'ev-1',
      title: 'Team Standup',
      startTime: localIso(2025, 6, 10, 9, 0),  // June 10 9:00 AM (Tuesday)
      endTime:   localIso(2025, 6, 10, 9, 30),
    });
    render(<WeekView {...defaultProps} events={[event]} />);
    expect(screen.getByText('Team Standup')).toBeTruthy();
  });

  it('renders an early-overflow indicator for events scrolled above the viewport', () => {
    const earlyEvent = makeEvent({
      id: 'ev-early',
      title: 'Early Bird Meeting',
      startTime: localIso(2025, 6, 10, 6, 0),  // 6 AM — ends at y=420px
      endTime:   localIso(2025, 6, 10, 7, 0),
    });
    const { container } = render(<WeekView {...defaultProps} events={[earlyEvent]} />);

    // Scroll past the event so it sits entirely above the visible window.
    scrollTimedArea(container, { viewportHeight: 600, scrollTop: 600 });

    const overflowZone = screen.getByTestId('early-overflow');
    // The indicator is a count, not a list of titles.
    expect(overflowZone.textContent).toContain('↑');
    expect(overflowZone.textContent).toContain('1');
  });

  it('renders a late-overflow indicator for events below the viewport', () => {
    const lateEvent = makeEvent({
      id: 'ev-late',
      title: 'Late Night Sync',
      startTime: localIso(2025, 6, 10, 21, 0), // 9 PM — starts at y=1260px
      endTime:   localIso(2025, 6, 10, 22, 0),
    });
    const { container } = render(<WeekView {...defaultProps} events={[lateEvent]} />);

    scrollTimedArea(container, { viewportHeight: 600, scrollTop: 60 });

    const overflowZone = screen.getByTestId('late-overflow');
    expect(overflowZone.textContent).toContain('↓');
    expect(overflowZone.textContent).toContain('1');
  });

  it('renders all-day events in the all-day band', () => {
    const allDayEvent = makeEvent({
      id: 'ev-allday',
      title: 'Company Holiday',
      startTime: '2025-06-10T00:00:00Z',
      endTime:   '2025-06-11T00:00:00Z',
      allDay: true,
    });
    render(<WeekView {...defaultProps} events={[allDayEvent]} />);
    const alldayBand = screen.getByTestId('allday-band');
    expect(alldayBand).toBeTruthy();
    expect(alldayBand.textContent).toContain('Company Holiday');
  });

  it('calls onEventClick when a timed event chip is clicked', () => {
    const onEventClick = vi.fn();
    const event = makeEvent({
      id: 'ev-click',
      title: 'Clickable Event',
      startTime: localIso(2025, 6, 10, 10, 0),
      endTime:   localIso(2025, 6, 10, 11, 0),
    });
    render(<WeekView {...defaultProps} events={[event]} onEventClick={onEventClick} />);
    const chip = screen.getByText('Clickable Event');
    fireEvent.click(chip);
    expect(onEventClick).toHaveBeenCalledOnce();
    expect(onEventClick).toHaveBeenCalledWith(event);
  });
});
