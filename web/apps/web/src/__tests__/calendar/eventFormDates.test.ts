/**
 * Tests for the event-modal date helpers in calendarHelpers.ts.
 *
 * They operate on the raw value of a `date` or `datetime-local` input, which is
 * wall-clock text (`YYYY-MM-DD` / `YYYY-MM-DDTHH:mm`) rather than an instant.
 *
 * Covers issue #129 — changing the start date used to leave the end date behind,
 * so the event ended before it began.
 */

import { describe, it, expect } from 'vitest';
import { shiftEndWithStart } from '../../app/(apps)/calendar/calendarHelpers';

describe('shiftEndWithStart', () => {
  it('moves the end date by the same number of days as the start moved', () => {
    // The example from issue #129: 12th–14th, start moved to the 15th.
    expect(shiftEndWithStart('2026-03-12', '2026-03-15', '2026-03-14')).toBe('2026-03-17');
  });

  it('keeps the gap when the start moves backwards', () => {
    expect(shiftEndWithStart('2026-03-15', '2026-03-12', '2026-03-17')).toBe('2026-03-14');
  });

  it('preserves the duration of a timed event', () => {
    expect(
      shiftEndWithStart('2026-03-12T09:00', '2026-03-15T09:00', '2026-03-14T17:30')
    ).toBe('2026-03-17T17:30');
  });

  it('shifts by the time of day as well as the date', () => {
    expect(
      shiftEndWithStart('2026-03-12T09:00', '2026-03-12T11:30', '2026-03-12T10:00')
    ).toBe('2026-03-12T12:30');
  });

  it('carries a shift across a month boundary', () => {
    expect(shiftEndWithStart('2026-03-30T09:00', '2026-04-02T09:00', '2026-03-31T09:00'))
      .toBe('2026-04-03T09:00');
  });

  it('keeps the wall-clock time across a DST change', () => {
    // US DST starts on 2026-03-08; a start moved over it must not drag the end's
    // clock time an hour either way.
    expect(shiftEndWithStart('2026-03-06T09:00', '2026-03-10T09:00', '2026-03-06T17:00'))
      .toBe('2026-03-10T17:00');
  });

  it('returns the end unchanged when the start did not move', () => {
    expect(shiftEndWithStart('2026-03-12T09:00', '2026-03-12T09:00', '2026-03-14T09:00'))
      .toBe('2026-03-14T09:00');
  });

  it('returns the end unchanged when a value is not a form date', () => {
    // A partially typed date lands here on every keystroke.
    expect(shiftEndWithStart('2026-03-12', '2026-0', '2026-03-14')).toBe('2026-03-14');
    expect(shiftEndWithStart('', '2026-03-15', '2026-03-14')).toBe('2026-03-14');
    expect(shiftEndWithStart('2026-03-12', '2026-03-15', '')).toBe('');
  });

  it('keeps a date-only end date-only and a timed end timed', () => {
    expect(shiftEndWithStart('2026-03-12', '2026-03-15', '2026-03-14')).toBe('2026-03-17');
    expect(shiftEndWithStart('2026-03-12', '2026-03-15', '2026-03-14T08:00'))
      .toBe('2026-03-17T08:00');
  });

  it('accepts a value carrying seconds, and drops them', () => {
    expect(shiftEndWithStart('2026-03-12T09:00:00', '2026-03-15T09:00:00', '2026-03-14T09:00:00'))
      .toBe('2026-03-17T09:00');
  });
});
