/**
 * Tests for the reminders date-range filter.
 *
 * The two rules worth pinning down are the ones that are easy to get backwards:
 *   - a range is an upper bound only, so an overdue reminder is never hidden by it
 *   - a range ends at the end of its last calendar day, not N×24 hours from now,
 *     so the boundary does not drift as the day goes on
 */

import { describe, it, expect } from 'vitest';
import {
  REMINDER_RANGES,
  isWithinReminderRange,
  reminderRangeEnd,
} from '../../app/(apps)/calendar/calendarHelpers';

// A Wednesday, mid-afternoon, so "end of day" is clearly not "now".
const now = new Date('2026-09-23T15:30:00');

const at = (iso: string) => new Date(iso).toISOString();

describe('reminderRangeEnd', () => {
  it('ends today at the end of today', () => {
    const end = reminderRangeEnd('today', now)!;
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(8); // September
    expect(end.getDate()).toBe(23);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it('counts today as the first day of a multi-day range', () => {
    // 3 days from Wednesday runs through the end of Friday, not Saturday.
    expect(reminderRangeEnd('3days', now)!.getDate()).toBe(25);
    // 7 days runs through the end of the following Tuesday.
    expect(reminderRangeEnd('7days', now)!.getDate()).toBe(29);
  });

  it('has no upper bound for all', () => {
    expect(reminderRangeEnd('all', now)).toBeNull();
  });

  it('does not drift with the time of day', () => {
    const morning = reminderRangeEnd('3days', new Date('2026-09-23T06:00:00'))!;
    const evening = reminderRangeEnd('3days', new Date('2026-09-23T22:00:00'))!;
    expect(morning.getTime()).toBe(evening.getTime());
  });

  it('rolls into the next month', () => {
    const end = reminderRangeEnd('7days', new Date('2026-09-28T09:00:00'))!;
    expect(end.getMonth()).toBe(9); // October
    expect(end.getDate()).toBe(4);
  });
});

describe('isWithinReminderRange', () => {
  it('keeps a reminder due later today', () => {
    expect(isWithinReminderRange(at('2026-09-23T18:00:00'), 'today', now)).toBe(true);
  });

  it('drops a reminder due tomorrow from today', () => {
    expect(isWithinReminderRange(at('2026-09-24T09:00:00'), 'today', now)).toBe(false);
  });

  it('keeps that same reminder in the 3-day range', () => {
    expect(isWithinReminderRange(at('2026-09-24T09:00:00'), '3days', now)).toBe(true);
  });

  it('drops a reminder past the end of the range', () => {
    expect(isWithinReminderRange(at('2026-09-26T09:00:00'), '3days', now)).toBe(false);
    expect(isWithinReminderRange(at('2026-09-30T09:00:00'), '7days', now)).toBe(false);
  });

  it('never hides an overdue reminder, whichever range is picked', () => {
    const yesterday = at('2026-09-22T09:00:00');
    const lastMonth = at('2026-08-01T09:00:00');
    for (const { value } of REMINDER_RANGES) {
      expect(isWithinReminderRange(yesterday, value, now)).toBe(true);
      expect(isWithinReminderRange(lastMonth, value, now)).toBe(true);
    }
  });

  it('keeps everything under all', () => {
    expect(isWithinReminderRange(at('2029-01-01T09:00:00'), 'all', now)).toBe(true);
  });

  it('shows a reminder whose due time cannot be read rather than dropping it', () => {
    expect(isWithinReminderRange('not a date', 'today', now)).toBe(true);
  });

  it('includes the very last instant of the range', () => {
    expect(isWithinReminderRange(at('2026-09-23T23:59:59'), 'today', now)).toBe(true);
  });
});
