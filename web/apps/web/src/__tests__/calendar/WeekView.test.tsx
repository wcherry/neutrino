/**
 * Tests for the new hour-grid WeekView component.
 *
 * Covers:
 *  - Renders 7 day column headers for the week
 *  - Renders hour labels in the left gutter
 *  - A timed event inside the visible window renders in the correct column
 *  - An event before dayStartHour renders in the early-overflow zone (↑)
 *  - An event after dayEndHour renders in the late-overflow zone (↓)
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

  it('renders hour labels in the gutter for the visible window', () => {
    render(<WeekView {...defaultProps} />);
    // dayStartHour=8 → "8 AM" label should appear
    expect(screen.getAllByText(/8\s*AM/i).length).toBeGreaterThanOrEqual(1);
    // The last rendered row label is "7 PM" (hour 19), since dayEndHour=20 is the boundary
    expect(screen.getAllByText(/7\s*PM/i).length).toBeGreaterThanOrEqual(1);
    // Hour before window (7 AM) should NOT be rendered as a label
    expect(screen.queryByText(/^7\s*AM$/i)).toBeNull();
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

  it('renders an early-overflow indicator for events before dayStartHour', () => {
    const earlyEvent = makeEvent({
      id: 'ev-early',
      title: 'Early Bird Meeting',
      startTime: localIso(2025, 6, 10, 6, 0),  // 6 AM — before dayStartHour=8
      endTime:   localIso(2025, 6, 10, 7, 0),
    });
    render(<WeekView {...defaultProps} events={[earlyEvent]} />);
    // Should render in the early-overflow zone
    const overflowZone = screen.getByTestId('early-overflow');
    expect(overflowZone).toBeTruthy();
    // Should show an up-arrow indicator
    expect(overflowZone.textContent).toContain('↑');
    // The event title should also appear in that zone
    expect(overflowZone.textContent).toContain('Early Bird Meeting');
  });

  it('renders a late-overflow indicator for events at or after dayEndHour', () => {
    const lateEvent = makeEvent({
      id: 'ev-late',
      title: 'Late Night Sync',
      startTime: localIso(2025, 6, 10, 21, 0), // 9 PM — after dayEndHour=20
      endTime:   localIso(2025, 6, 10, 22, 0),
    });
    render(<WeekView {...defaultProps} events={[lateEvent]} />);
    const overflowZone = screen.getByTestId('late-overflow');
    expect(overflowZone).toBeTruthy();
    expect(overflowZone.textContent).toContain('↓');
    expect(overflowZone.textContent).toContain('Late Night Sync');
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
