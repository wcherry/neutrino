/**
 * Tests for multi-day event coverage — issue #130.
 *
 * An event used to be listed only on the day it started, so the rest of the days
 * it booked looked free. These cover the helpers behind the fix:
 *   - eventDayRange / eventOccupiesDay — which local days an event covers
 *   - eventsForDay — every view's "what is on this day"
 *   - buildWeekEventSegments — one bar per event per week row of the month grid
 *   - getEventDayBounds — the part of an event that falls on one week-view day
 */

import { describe, it, expect } from 'vitest';
import type { EventResponse } from '../../lib/api';
import {
  eventDayRange,
  eventOccupiesDay,
  eventsForDay,
  buildWeekEventSegments,
  getEventDayBounds,
} from '../../app/(apps)/calendar/calendarHelpers';

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
    timezone: null,
    createdAt: overrides.startTime,
    updatedAt: overrides.startTime,
    ...overrides,
  };
}

/** An all-day event as the modal writes it: midnight to 23:59:59 on the last day. */
function allDayEvent(id: string, firstDay: string, lastDay: string): EventResponse {
  return makeEvent({
    id,
    title: id,
    startTime: `${firstDay}T00:00:00Z`,
    endTime: `${lastDay}T23:59:59Z`,
    allDay: true,
  });
}

/** A timed event, in local time so the day it lands on does not depend on the zone. */
function timedEvent(id: string, start: Date, end: Date): EventResponse {
  return makeEvent({ id, title: id, startTime: start.toISOString(), endTime: end.toISOString() });
}

const d = (y: number, m: number, day: number, h = 0, min = 0) => new Date(y, m - 1, day, h, min);

// A Sunday-started week: 2026-03-08 … 2026-03-14.
const WEEK = Array.from({ length: 7 }, (_, i) => d(2026, 3, 8 + i));

// ---------------------------------------------------------------------------
// eventDayRange / eventOccupiesDay
// ---------------------------------------------------------------------------

describe('eventDayRange', () => {
  it('covers every day of a multi-day all-day event', () => {
    const { first, last } = eventDayRange(allDayEvent('a', '2026-03-10', '2026-03-12'));
    expect(first).toEqual(d(2026, 3, 10));
    expect(last).toEqual(d(2026, 3, 12));
  });

  it('covers one day for a single-day all-day event', () => {
    const { first, last } = eventDayRange(allDayEvent('a', '2026-03-10', '2026-03-10'));
    expect(first).toEqual(d(2026, 3, 10));
    expect(last).toEqual(d(2026, 3, 10));
  });

  it('treats an all-day end at midnight as exclusive, the way an .ics DTEND is', () => {
    const ev = makeEvent({
      id: 'ics', title: 'ics',
      startTime: '2026-03-10T00:00:00Z', endTime: '2026-03-12T00:00:00Z', allDay: true,
    });
    expect(eventDayRange(ev).last).toEqual(d(2026, 3, 11));
  });

  it('covers every day a timed event runs across', () => {
    const { first, last } = eventDayRange(timedEvent('t', d(2026, 3, 10, 22), d(2026, 3, 12, 3)));
    expect(first).toEqual(d(2026, 3, 10));
    expect(last).toEqual(d(2026, 3, 12));
  });

  it('does not claim the next day for an event ending exactly at midnight', () => {
    const { last } = eventDayRange(timedEvent('t', d(2026, 3, 10, 22), d(2026, 3, 11, 0)));
    expect(last).toEqual(d(2026, 3, 10));
  });

  it('falls back to the start day when the end is before the start', () => {
    const { first, last } = eventDayRange(timedEvent('t', d(2026, 3, 12, 9), d(2026, 3, 10, 9)));
    expect(first).toEqual(d(2026, 3, 12));
    expect(last).toEqual(d(2026, 3, 12));
  });
});

describe('eventOccupiesDay', () => {
  const ev = allDayEvent('a', '2026-03-10', '2026-03-12');

  it('is true on the first day', () => {
    expect(eventOccupiesDay(ev, d(2026, 3, 10))).toBe(true);
  });

  it('is true on a day in the middle — the day the bug left blank', () => {
    expect(eventOccupiesDay(ev, d(2026, 3, 11))).toBe(true);
  });

  it('is true on the last day', () => {
    expect(eventOccupiesDay(ev, d(2026, 3, 12))).toBe(true);
  });

  it('is false the day before and the day after', () => {
    expect(eventOccupiesDay(ev, d(2026, 3, 9))).toBe(false);
    expect(eventOccupiesDay(ev, d(2026, 3, 13))).toBe(false);
  });

  it('ignores the time of day it is asked about', () => {
    expect(eventOccupiesDay(ev, d(2026, 3, 11, 23, 59))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// eventsForDay
// ---------------------------------------------------------------------------

describe('eventsForDay', () => {
  const spanning = allDayEvent('span', '2026-03-10', '2026-03-12');
  const single = timedEvent('single', d(2026, 3, 11, 9), d(2026, 3, 11, 10));
  const events = [spanning, single];

  it('returns a multi-day event on each of its days', () => {
    expect(eventsForDay(events, d(2026, 3, 10)).map((e) => e.id)).toEqual(['span']);
    expect(eventsForDay(events, d(2026, 3, 11)).map((e) => e.id)).toEqual(['span', 'single']);
    expect(eventsForDay(events, d(2026, 3, 12)).map((e) => e.id)).toEqual(['span']);
  });

  it('still returns nothing on a day no event touches', () => {
    expect(eventsForDay(events, d(2026, 3, 13))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildWeekEventSegments
// ---------------------------------------------------------------------------

describe('buildWeekEventSegments', () => {
  it('gives a multi-day event one segment spanning its columns', () => {
    const segments = buildWeekEventSegments([allDayEvent('a', '2026-03-10', '2026-03-12')], WEEK);
    expect(segments).toHaveLength(1);
    expect(segments[0].startIndex).toBe(2); // Tuesday the 10th
    expect(segments[0].span).toBe(3);
    expect(segments[0].continuesBefore).toBe(false);
    expect(segments[0].continuesAfter).toBe(false);
  });

  it('gives a single-day event a segment one column wide', () => {
    const segments = buildWeekEventSegments(
      [timedEvent('t', d(2026, 3, 11, 9), d(2026, 3, 11, 10))], WEEK,
    );
    expect(segments[0]).toMatchObject({ startIndex: 3, span: 1 });
  });

  it('clips an event that starts before the week and marks it as continuing', () => {
    const segments = buildWeekEventSegments([allDayEvent('a', '2026-03-05', '2026-03-09')], WEEK);
    expect(segments[0]).toMatchObject({
      startIndex: 0, span: 2, continuesBefore: true, continuesAfter: false,
    });
  });

  it('clips an event that runs past the week and marks it as continuing', () => {
    const segments = buildWeekEventSegments([allDayEvent('a', '2026-03-13', '2026-03-20')], WEEK);
    expect(segments[0]).toMatchObject({
      startIndex: 5, span: 2, continuesBefore: false, continuesAfter: true,
    });
  });

  it('spans the whole row for an event that covers the week end to end', () => {
    const segments = buildWeekEventSegments([allDayEvent('a', '2026-03-01', '2026-03-31')], WEEK);
    expect(segments[0]).toMatchObject({
      startIndex: 0, span: 7, continuesBefore: true, continuesAfter: true,
    });
  });

  it('skips an event that misses the week entirely', () => {
    expect(buildWeekEventSegments([allDayEvent('a', '2026-04-01', '2026-04-03')], WEEK)).toEqual([]);
    expect(buildWeekEventSegments([allDayEvent('b', '2026-02-01', '2026-02-03')], WEEK)).toEqual([]);
  });

  it('stacks overlapping events into separate lanes', () => {
    const segments = buildWeekEventSegments([
      allDayEvent('a', '2026-03-09', '2026-03-11'),
      allDayEvent('b', '2026-03-10', '2026-03-12'),
    ], WEEK);
    const lanes = Object.fromEntries(segments.map((s) => [s.event.id, s.lane]));
    expect(lanes).toEqual({ a: 0, b: 1 });
  });

  it('reuses a lane for events that do not overlap', () => {
    const segments = buildWeekEventSegments([
      allDayEvent('a', '2026-03-08', '2026-03-09'),
      allDayEvent('b', '2026-03-11', '2026-03-12'),
    ], WEEK);
    expect(segments.every((s) => s.lane === 0)).toBe(true);
  });

  it('puts the longer run above the days it crosses', () => {
    const segments = buildWeekEventSegments([
      timedEvent('short', d(2026, 3, 10, 9), d(2026, 3, 10, 10)),
      allDayEvent('long', '2026-03-10', '2026-03-13'),
    ], WEEK);
    const lanes = Object.fromEntries(segments.map((s) => [s.event.id, s.lane]));
    expect(lanes.long).toBe(0);
    expect(lanes.short).toBe(1);
  });

  it('keys recurring occurrences apart, since they share an event id', () => {
    const recurring = { recurrenceRule: 'FREQ=DAILY' };
    const segments = buildWeekEventSegments([
      makeEvent({ id: 'r', title: 'Standup', startTime: d(2026, 3, 9, 9).toISOString(), endTime: d(2026, 3, 9, 10).toISOString(), ...recurring }),
      makeEvent({ id: 'r', title: 'Standup', startTime: d(2026, 3, 10, 9).toISOString(), endTime: d(2026, 3, 10, 10).toISOString(), ...recurring }),
    ], WEEK);
    expect(new Set(segments.map((s) => s.key)).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getEventDayBounds
// ---------------------------------------------------------------------------

describe('getEventDayBounds', () => {
  const HOUR_HEIGHT = 60;

  it('positions a same-day event at its own start and length', () => {
    const ev = timedEvent('t', d(2026, 3, 10, 9), d(2026, 3, 10, 11));
    expect(getEventDayBounds(ev, d(2026, 3, 10), HOUR_HEIGHT)).toEqual({ top: 540, height: 120 });
  });

  it('clamps to the end of the day it starts on', () => {
    const ev = timedEvent('t', d(2026, 3, 10, 22), d(2026, 3, 12, 3));
    expect(getEventDayBounds(ev, d(2026, 3, 10), HOUR_HEIGHT)).toEqual({ top: 1320, height: 120 });
  });

  it('fills a whole day in the middle of the run', () => {
    const ev = timedEvent('t', d(2026, 3, 10, 22), d(2026, 3, 12, 3));
    expect(getEventDayBounds(ev, d(2026, 3, 11), HOUR_HEIGHT)).toEqual({ top: 0, height: 1440 });
  });

  it('runs from midnight to the end on the last day', () => {
    const ev = timedEvent('t', d(2026, 3, 10, 22), d(2026, 3, 12, 3));
    expect(getEventDayBounds(ev, d(2026, 3, 12), HOUR_HEIGHT)).toEqual({ top: 0, height: 180 });
  });

  it('keeps the 24px minimum height of a very short event', () => {
    const ev = timedEvent('t', d(2026, 3, 10, 9), d(2026, 3, 10, 9, 5));
    expect(getEventDayBounds(ev, d(2026, 3, 10), HOUR_HEIGHT).height).toBe(24);
  });
});
