/**
 * Expanding a repeating event with its exceptions (agent_docs/recurrence-exceptions.md). The iOS
 * app's `RecurrenceExceptionTests` holds `RecurrenceExpander` to the same cases.
 *
 * January 2027 has no DST change in any zone the suite runs in, so a daily 09:00 UTC event is at
 * 09:00 UTC every day whatever the machine's zone.
 */
import { describe, it, expect } from 'vitest';
import { expandRecurringEvents, ruleFromOccurrence } from '../../app/(apps)/calendar/calendarHelpers';
import type { EventResponse } from '@/lib/api';

const event = (fields: Partial<EventResponse>): EventResponse => ({
  id: 'series',
  title: 'Standup',
  description: null,
  startTime: '2027-01-04T09:00:00.000Z',
  endTime: '2027-01-04T09:30:00.000Z',
  allDay: false,
  location: null,
  recurrenceRule: 'FREQ=DAILY;COUNT=5',
  attendees: [],
  source: 'local',
  createdAt: '2027-01-01T00:00:00Z',
  updatedAt: '2027-01-01T00:00:00Z',
  timezone: null,
  ...fields,
});

const exception = (id: string, originalStartTime: string, fields: Partial<EventResponse> = {}) =>
  event({
    id,
    recurrenceRule: null,
    recurringEventId: 'series',
    originalStartTime,
    startTime: originalStartTime,
    endTime: new Date(Date.parse(originalStartTime) + 30 * 60_000).toISOString(),
    cancelled: false,
    ...fields,
  });

const january = (events: EventResponse[]) =>
  expandRecurringEvents(events, new Date('2027-01-01T00:00:00Z'), new Date('2027-01-31T23:59:59Z'));

/** Sorted: occurrences come out series by series, and the views sort them by start. */
const summary = (events: EventResponse[]) =>
  january(events).map((o) => `${o.startTime.slice(5, 16)} ${o.title}`).sort();

describe('expanding with exceptions', () => {
  it('gives every occurrence its series and its start in it', () => {
    const [first] = january([event({})]);
    expect(first.series?.id).toBe('series');
    expect(first.occurrenceStart).toBe('2027-01-04T09:00:00.000Z');
  });

  it('shows an edited occurrence in place of the one it replaces', () => {
    expect(summary([
      event({}),
      exception('ex', '2027-01-05T09:00:00Z', { title: 'Planning', startTime: '2027-01-05T14:00:00Z' }),
    ])).toEqual([
      '01-04T09:00 Standup',
      '01-05T14:00 Planning',
      '01-06T09:00 Standup',
      '01-07T09:00 Standup',
      '01-08T09:00 Standup',
    ]);
  });

  it('keeps the series and original start on an edited occurrence, for the next edit', () => {
    const shown = january([event({}), exception('ex', '2027-01-05T09:00:00Z', { title: 'Planning' })])
      .find((o) => o.title === 'Planning')!;
    expect(shown.id).toBe('ex');
    expect(shown.series?.id).toBe('series');
    expect(shown.occurrenceStart).toBe('2027-01-05T09:00:00Z');
  });

  it('drops a cancelled occurrence, which still counts towards COUNT', () => {
    expect(summary([event({}), exception('ex', '2027-01-06T09:00:00Z', { cancelled: true })]))
      .toEqual(['01-04T09:00 Standup', '01-05T09:00 Standup', '01-07T09:00 Standup', '01-08T09:00 Standup']);
  });

  it('matches an exception up to two hours from the occurrence, as a viewer in another zone sees it', () => {
    expect(summary([event({}), exception('ex', '2027-01-06T08:00:00Z', { cancelled: true })]))
      .not.toContain('01-06T09:00 Standup');
    expect(summary([event({}), exception('ex', '2027-01-06T06:00:00Z', { cancelled: true })]))
      .toContain('01-06T09:00 Standup');
  });

  it('shows an occurrence moved in from outside the range, and not one moved out', () => {
    const series = event({ recurrenceRule: 'FREQ=WEEKLY', startTime: '2026-12-28T09:00:00Z', endTime: '2026-12-28T09:30:00Z' });
    const movedIn = exception('in', '2026-12-28T09:00:00Z', { title: 'Moved in', startTime: '2027-01-02T09:00:00Z' });
    const movedOut = exception('out', '2027-01-25T09:00:00Z', { title: 'Moved out', startTime: '2027-02-02T09:00:00Z' });
    expect(summary([series, movedIn, movedOut])).toEqual([
      '01-02T09:00 Moved in',
      '01-04T09:00 Standup',
      '01-11T09:00 Standup',
      '01-18T09:00 Standup',
    ]);
  });

  it('does not show an exception whose occurrence the series no longer has', () => {
    expect(summary([event({}), exception('orphan', '2027-01-20T09:00:00Z', { title: 'Orphan' })]))
      .not.toContain('01-20T09:00 Orphan');
  });

  it('ignores exceptions of other series', () => {
    const other = { ...exception('ex', '2027-01-05T09:00:00Z', { cancelled: true }), recurringEventId: 'other' };
    expect(summary([event({}), other])).toHaveLength(5);
  });
});

describe('the rule for this and following', () => {
  it('takes the occurrences before the one split at off COUNT', () => {
    expect(ruleFromOccurrence(event({ recurrenceRule: 'FREQ=DAILY;COUNT=5' }), '2027-01-06T09:00:00.000Z'))
      .toBe('FREQ=DAILY;COUNT=3');
  });

  it('leaves a rule without COUNT as it is', () => {
    expect(ruleFromOccurrence(event({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' }), '2027-01-11T09:00:00Z'))
      .toBe('FREQ=WEEKLY;BYDAY=MO');
  });
});
