/**
 * Calendars on the client (`calendar/calendars.ts`): visibility, read-only, colours, and the
 * days of holiday calendars computed from the real `date-holidays` rules.
 */

import { describe, it, expect } from 'vitest';
import Holidays from 'date-holidays';
import type { CalendarResponse, EventResponse } from '@neutrino/api-calendar';
import {
  HOLIDAY_SOURCE,
  calendarMap,
  eventColorStyle,
  holidayEvents,
  holidaysOf,
  isReadOnlyEvent,
  visibleEvents,
  writableCalendars,
} from '../../app/(apps)/calendar/calendars';

type Ctor = Parameters<typeof holidaysOf>[0];
const rules = Holidays as unknown as Ctor;

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

function event(id: string, calendarId: string | null, overrides: Partial<EventResponse> = {}): EventResponse {
  return {
    id,
    title: id,
    description: null,
    startTime: '2026-10-01T09:00:00Z',
    endTime: '2026-10-01T10:00:00Z',
    allDay: false,
    location: null,
    recurrenceRule: null,
    attendees: [],
    source: 'local',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    timezone: null,
    calendarId,
    ...overrides,
  };
}

const us = calendar({ id: 'us', kind: 'holidays', readOnly: true, country: 'US', name: 'United States' });

function days(events: EventResponse[], title: string): string[] {
  return events.filter((e) => e.title === title).map((e) => e.startTime.slice(0, 10));
}

describe('holidaysOf', () => {
  const twoYears = holidaysOf(rules, us, '2026-01-01T00:00:00Z', '2027-12-31T23:59:59Z', 'en-US');

  it('puts Thanksgiving on the fourth Thursday of November, this year and next', () => {
    expect(days(twoYears, 'Thanksgiving Day')).toEqual(['2026-11-26', '2027-11-25']);
  });

  it('puts Labor Day on the first Monday of September, this year and next', () => {
    expect(days(twoYears, 'Labor Day')).toEqual(['2026-09-07', '2027-09-06']);
  });

  it('makes all-day events in the calendar, which read as holidays', () => {
    const thanksgiving = twoYears.find((e) => e.title === 'Thanksgiving Day')!;
    expect(thanksgiving).toMatchObject({
      allDay: true,
      startTime: '2026-11-26T00:00:00Z',
      endTime: '2026-11-26T23:59:59Z',
      calendarId: 'us',
      source: HOLIDAY_SOURCE,
    });
  });

  it('leaves observances out unless the calendar asks for them', () => {
    expect(days(twoYears, "Mother's Day")).toEqual([]);
    const withObservances = holidaysOf(
      rules,
      { ...us, includeObservances: true },
      '2026-01-01T00:00:00Z',
      '2026-12-31T23:59:59Z',
      'en-US',
    );
    expect(days(withObservances, "Mother's Day")).toEqual(['2026-05-10']);
    expect(days(withObservances, 'Halloween')).toEqual(['2026-10-31']);
  });

  it('gives only the days in the range', () => {
    const november = holidaysOf(rules, us, '2026-11-01T00:00:00Z', '2026-11-30T23:59:59Z', 'en-US');
    expect(november.map((e) => e.startTime.slice(0, 10)).every((d) => d.startsWith('2026-11'))).toBe(true);
    expect(days(november, 'Thanksgiving Day')).toEqual(['2026-11-26']);
  });

  it('adds a region’s own holidays', () => {
    const range = ['2026-01-01T00:00:00Z', '2026-12-31T23:59:59Z'] as const;
    const de = calendar({ id: 'de', kind: 'holidays', readOnly: true, country: 'DE' });
    const nationwide = holidaysOf(rules, de, ...range);
    const bavaria = holidaysOf(rules, { ...de, region: 'BY' }, ...range);
    expect(bavaria.length).toBeGreaterThan(nationwide.length);
  });

  it('gives nothing for a calendar that isn’t a holiday calendar', () => {
    expect(holidaysOf(rules, calendar({ country: 'US' }), '2026-01-01T00:00:00Z', '2026-12-31T23:59:59Z')).toEqual([]);
  });
});

describe('holidayEvents', () => {
  it('shows nothing for a hidden holiday calendar', async () => {
    const hidden = await holidayEvents([{ ...us, visible: false }], '2026-11-01T00:00:00Z', '2026-11-30T23:59:59Z', 'en-US');
    expect(hidden).toEqual([]);
  });

  it('shows each country’s holidays in its own calendar', async () => {
    const ca = calendar({ id: 'ca', kind: 'holidays', readOnly: true, country: 'CA' });
    const both = await holidayEvents([us, ca], '2026-07-01T00:00:00Z', '2026-07-31T23:59:59Z', 'en-US');
    expect(both.find((e) => e.title === 'Independence Day')?.calendarId).toBe('us');
    expect(both.find((e) => e.title === 'Canada Day')?.calendarId).toBe('ca');
  });
});

describe('visibleEvents', () => {
  const calendars = calendarMap([calendar({ id: 'shown' }), calendar({ id: 'hidden', visible: false })]);

  it('drops the events of a hidden calendar and keeps the rest', () => {
    const events = [event('a', 'shown'), event('b', 'hidden'), event('c', null), event('d', 'unknown')];
    expect(visibleEvents(events, calendars).map((e) => e.id)).toEqual(['a', 'c', 'd']);
  });
});

describe('isReadOnlyEvent', () => {
  const calendars = calendarMap([calendar({ id: 'mine' }), us]);

  it('is true in a read-only calendar and for a holiday, false otherwise', () => {
    expect(isReadOnlyEvent(event('a', 'mine'), calendars)).toBe(false);
    expect(isReadOnlyEvent(event('b', 'us'), calendars)).toBe(true);
    expect(isReadOnlyEvent(event('c', null, { source: HOLIDAY_SOURCE }), calendars)).toBe(true);
    expect(isReadOnlyEvent(event('d', null), calendars)).toBe(false);
  });
});

describe('writableCalendars', () => {
  it('offers only calendars an event can go in', () => {
    expect(writableCalendars([calendar({ id: 'mine' }), us]).map((c) => c.id)).toEqual(['mine']);
  });
});

describe('eventColorStyle', () => {
  it('sets the colour the views read, or nothing for no colour', () => {
    expect(eventColorStyle('#e11d48')).toMatchObject({ '--event-solid': '#e11d48' });
    expect(eventColorStyle(undefined)).toBeUndefined();
  });
});
