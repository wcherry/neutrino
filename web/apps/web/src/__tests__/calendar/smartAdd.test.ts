/**
 * Smart Add, against the fixture table the iOS Calendar app's Swift port is tested against too.
 * A case in the table lists only the fields it sets; everything else must come back empty.
 */

import { describe, it, expect } from 'vitest';
import {
  describeRepeat,
  formatEstimate,
  parseEstimate,
  parseFriendlyDate,
  parseRepeat,
  parseSmartAdd,
  smartDateToWire,
  type SmartAddResult,
} from '../../app/(apps)/calendar/smartAdd';
import fixtures from '../../app/(apps)/calendar/smartAddFixtures.json';

const empty = (input: string): SmartAddResult => ({
  title: input,
  due: null,
  start: null,
  priority: null,
  tags: [],
  recurrenceRule: null,
  repeatAfterCompletion: false,
  estimateMinutes: null,
  location: null,
  note: null,
});

describe('parseSmartAdd fixtures', () => {
  it.each(fixtures.cases.map((c) => [c.input, c.expect] as const))('%s', (input, expected) => {
    expect(parseSmartAdd(input, fixtures.context)).toEqual({ ...empty(input), ...expected });
  });
});

describe('smartDateToWire', () => {
  it('writes a date with no time as that day at UTC midnight, as the task editor does', () => {
    expect(smartDateToWire({ date: '2026-10-03', time: null })).toEqual({
      iso: '2026-10-03T00:00:00Z',
      hasTime: false,
    });
  });

  it('writes a timed date as the instant it names in the local zone, without milliseconds', () => {
    const { iso, hasTime } = smartDateToWire({ date: '2026-10-03', time: '17:30' });
    expect(hasTime).toBe(true);
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/);
    expect(new Date(iso).getTime()).toBe(new Date(2026, 9, 3, 17, 30).getTime());
  });
});

describe('the editor fields', () => {
  const rules = fixtures.cases
    .map((c) => c.expect as Partial<SmartAddResult>)
    .filter((e) => e.recurrenceRule)
    .map((e) => [e.recurrenceRule!, e.repeatAfterCompletion ?? false] as const);

  it.each(rules)('describes %s in words that parse back to it', (rule, after) => {
    expect(parseRepeat(describeRepeat(rule, after))).toEqual({ rule, after });
  });

  it.each([5, 45, 60, 90, 150])('formats an estimate of %i minutes so it parses back', (m) => {
    expect(parseEstimate(formatEstimate(m))).toBe(m);
  });

  it('reads a whole field as a date, and nothing that is only partly one', () => {
    expect(parseFriendlyDate('next fri 3pm', fixtures.context)).toEqual({ date: '2026-10-02', time: '15:00' });
    expect(parseFriendlyDate('fri and then some', fixtures.context)).toBeNull();
    expect(parseFriendlyDate('', fixtures.context)).toBeNull();
  });
});
