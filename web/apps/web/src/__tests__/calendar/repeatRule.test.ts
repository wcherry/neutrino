/**
 * Tests for repeatRule.ts: the event form's reading and writing of an RRULE.
 *
 * The fixture table is shared with the iOS app (`RepeatRule.swift`), which copies it with
 * `scripts/sync_repeat_rule_vectors.sh`; a case added here holds both clients to it.
 */

import { describe, it, expect } from 'vitest';
import {
  parseRepeatRule,
  buildRepeatRule,
  repeatPreset,
  withRepeatPreset,
  defaultRepeatEndDate,
  type RepeatRule,
} from '../../app/(apps)/calendar/repeatRule';
import { expandRecurringEvents } from '../../app/(apps)/calendar/calendarHelpers';
import { REPEAT_OPTIONS } from '../../app/(apps)/calendar/calendarConstants';
import fixtures from '../../app/(apps)/calendar/repeatRuleFixtures.json';
import type { EventResponse } from '@/lib/api';

describe('repeat rule fixtures', () => {
  for (const c of fixtures.parse) {
    it(`parses ${c.name}`, () => {
      const ctx = { allDay: c.allDay, timeZone: c.timeZone };
      const parsed = parseRepeatRule(c.rule, ctx);
      expect(parsed).toEqual(c.expected);
      if (parsed) expect(buildRepeatRule(parsed, ctx)).toBe(c.rebuilt);
    });
  }
  for (const c of fixtures.build) {
    it(`builds ${c.name}`, () => {
      expect(buildRepeatRule(c.rule as RepeatRule, { allDay: c.allDay, timeZone: c.timeZone })).toBe(c.expected);
    });
  }
});

describe('the form choices', () => {
  const ctx = { allDay: false, timeZone: 'UTC' };

  it('shows every stored preset under itself', () => {
    for (const option of REPEAT_OPTIONS.filter((o) => o.value)) {
      expect(repeatPreset(parseRepeatRule(option.value, ctx)!)).toBe(option.value);
    }
  });

  it('shows a weekly rule on other days as Weekly, and keeps the days', () => {
    const rule = parseRepeatRule('FREQ=WEEKLY;BYDAY=MO,TH', ctx)!;
    expect(repeatPreset(rule)).toBe('FREQ=WEEKLY');
    expect(withRepeatPreset(rule, 'FREQ=WEEKLY')).toBe(rule);
  });

  it('keeps the interval and end across a change of frequency, and drops the days', () => {
    const rule = parseRepeatRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR;COUNT=5', ctx)!;
    const daily = withRepeatPreset(rule, 'FREQ=DAILY')!;
    expect(buildRepeatRule(daily, ctx)).toBe('FREQ=DAILY;INTERVAL=2;COUNT=5');
    expect(withRepeatPreset(daily, '')).toBeNull();
    expect(buildRepeatRule(withRepeatPreset(null, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')!, ctx))
      .toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  });

  it('offers an end date a month out, or a year for monthly and yearly', () => {
    expect(defaultRepeatEndDate('2026-01-31T09:00', 'DAILY')).toBe('2026-03-03');
    expect(defaultRepeatEndDate('2026-09-29', 'WEEKLY')).toBe('2026-10-29');
    expect(defaultRepeatEndDate('2026-09-29', 'YEARLY')).toBe('2027-09-29');
  });
});

describe('what the form writes, expanded', () => {
  const ev = (rule: string): EventResponse => ({
    id: 'e', title: 'e', startTime: '2026-09-01T17:00:00Z', endTime: '2026-09-01T18:00:00Z',
    allDay: false, recurrenceRule: rule,
  } as EventResponse);
  const days = (rule: string) =>
    expandRecurringEvents([ev(rule)], new Date('2026-08-01T00:00:00Z'), new Date('2027-01-01T00:00:00Z'))
      .map((e) => e.startTime.slice(0, 10));

  it('counts occurrences, not weeks, for every weekday', () => {
    expect(days('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=4'))
      .toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
  });

  it('stops on the end date, including it', () => {
    const ctx = { allDay: false, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    const rule = buildRepeatRule(
      { freq: 'DAILY', interval: 4, byDay: null, end: { kind: 'on', date: '2026-09-13' }, extra: [] }, ctx);
    expect(days(rule)).toEqual(['2026-09-01', '2026-09-05', '2026-09-09', '2026-09-13']);
  });
});
