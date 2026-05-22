/**
 * Tests for week-view helper functions.
 *
 * These helpers will be added to calendarHelpers.ts:
 *   - getEventMinutesFromMidnight
 *   - isBeforeDayStart
 *   - isAfterDayEnd
 *   - getEventTopOffset
 *   - getEventHeight
 */

import { describe, it, expect } from 'vitest';
import {
  getEventMinutesFromMidnight,
  isBeforeDayStart,
  isAfterDayEnd,
  getEventTopOffset,
  getEventHeight,
} from '../../app/(apps)/calendar/calendarHelpers';

const HOUR_HEIGHT = 60; // 60px per hour

// Build an ISO string with a known local time on 2025-06-10
function localIso(hour: number, minute = 0): string {
  const d = new Date(2025, 5, 10, hour, minute, 0); // June 10 2025
  return d.toISOString();
}

describe('getEventMinutesFromMidnight', () => {
  it('returns 0 for midnight', () => {
    expect(getEventMinutesFromMidnight(localIso(0, 0))).toBe(0);
  });

  it('returns 480 for 8:00 AM', () => {
    expect(getEventMinutesFromMidnight(localIso(8, 0))).toBe(480);
  });

  it('returns 510 for 8:30 AM', () => {
    expect(getEventMinutesFromMidnight(localIso(8, 30))).toBe(510);
  });

  it('returns 720 for noon', () => {
    expect(getEventMinutesFromMidnight(localIso(12, 0))).toBe(720);
  });

  it('returns 1380 for 11:00 PM', () => {
    expect(getEventMinutesFromMidnight(localIso(23, 0))).toBe(1380);
  });
});

describe('isBeforeDayStart', () => {
  it('returns true when event starts before dayStartHour', () => {
    // 7:00 AM, dayStart = 8
    expect(isBeforeDayStart(localIso(7, 0), 8)).toBe(true);
  });

  it('returns false when event starts exactly at dayStartHour', () => {
    expect(isBeforeDayStart(localIso(8, 0), 8)).toBe(false);
  });

  it('returns false when event starts after dayStartHour', () => {
    expect(isBeforeDayStart(localIso(9, 30), 8)).toBe(false);
  });

  it('returns true when event starts at 6 AM and dayStart is 9', () => {
    expect(isBeforeDayStart(localIso(6, 0), 9)).toBe(true);
  });
});

describe('isAfterDayEnd', () => {
  it('returns true when event starts at or after dayEndHour', () => {
    // 20:00, dayEnd = 20
    expect(isAfterDayEnd(localIso(20, 0), 20)).toBe(true);
  });

  it('returns true when event starts after dayEndHour', () => {
    expect(isAfterDayEnd(localIso(21, 0), 20)).toBe(true);
  });

  it('returns false when event starts before dayEndHour', () => {
    expect(isAfterDayEnd(localIso(19, 59), 20)).toBe(false);
  });

  it('returns false for event well within the window', () => {
    expect(isAfterDayEnd(localIso(10, 0), 20)).toBe(false);
  });
});

describe('getEventTopOffset', () => {
  it('returns 0 for an event starting exactly at dayStartHour', () => {
    expect(getEventTopOffset(localIso(8, 0), 8, HOUR_HEIGHT)).toBe(0);
  });

  it('returns HOUR_HEIGHT for an event 1 hour after dayStartHour', () => {
    expect(getEventTopOffset(localIso(9, 0), 8, HOUR_HEIGHT)).toBe(HOUR_HEIGHT);
  });

  it('returns 30 for an event 30 minutes after dayStartHour', () => {
    expect(getEventTopOffset(localIso(8, 30), 8, HOUR_HEIGHT)).toBe(30);
  });

  it('returns 0 for an event starting at dayStartHour with a different hour height', () => {
    expect(getEventTopOffset(localIso(8, 0), 8, 80)).toBe(0);
  });

  it('returns correct offset for noon with dayStart=8 and hourHeight=60', () => {
    // noon = 12:00, dayStart=8 → 4 hours = 4*60 = 240px
    expect(getEventTopOffset(localIso(12, 0), 8, HOUR_HEIGHT)).toBe(240);
  });
});

describe('getEventHeight', () => {
  it('returns 60 for a 1-hour event', () => {
    const start = localIso(9, 0);
    const end = localIso(10, 0);
    expect(getEventHeight(start, end, HOUR_HEIGHT)).toBe(60);
  });

  it('returns 30 for a 30-minute event', () => {
    const start = localIso(9, 0);
    const end = localIso(9, 30);
    expect(getEventHeight(start, end, HOUR_HEIGHT)).toBe(30);
  });

  it('enforces a minimum height of 24px', () => {
    // 5-minute event would be 5px — should be clamped to 24
    const start = localIso(9, 0);
    const end = localIso(9, 5);
    expect(getEventHeight(start, end, HOUR_HEIGHT)).toBe(24);
  });

  it('returns 120 for a 2-hour event', () => {
    const start = localIso(9, 0);
    const end = localIso(11, 0);
    expect(getEventHeight(start, end, HOUR_HEIGHT)).toBe(120);
  });
});
