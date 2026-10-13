/**
 * Tests for icsImport.ts: an `.ics` dropped onto Calendar or Drive becomes calendar events.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const listEvents = vi.fn();
const createEvent = vi.fn();
vi.mock('@neutrino/api-calendar', () => ({
  calendarApi: {
    listEvents: (...args: unknown[]) => listEvents(...args),
    createEvent: (...args: unknown[]) => createEvent(...args),
  },
}));

import {
  parseIcsEvents,
  importIcsFiles,
  describeIcsImport,
  isIcsFile,
} from '@/app/(apps)/calendar/icsImport';

/** One event's lines. */
const lines = (...l: string[]) => l.join('\r\n');
/** A calendar with one VEVENT per argument. */
const ics = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap((e) => ['BEGIN:VEVENT', e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

describe('parseIcsEvents', () => {
  it('reads a UTC event', () => {
    const [ev] = parseIcsEvents(ics('SUMMARY:Standup\r\nDTSTART:20261020T160000Z\r\nDTEND:20261020T161500Z'), 'Europe/London');
    expect(ev).toMatchObject({
      title: 'Standup',
      startTime: '2026-10-20T16:00:00.000Z',
      endTime: '2026-10-20T16:15:00.000Z',
      allDay: false,
      timezone: 'Europe/London',
      recurrenceRule: null,
    });
  });

  it('places a TZID time in its own zone, not in UTC', () => {
    const [ev] = parseIcsEvents(ics(lines(
      'SUMMARY:Lunch',
      'DTSTART;TZID=America/New_York:20260115T120000',
      'DTEND;TZID=America/New_York:20260115T130000',
    )), 'UTC');
    expect(ev.startTime).toBe('2026-01-15T17:00:00.000Z');
    expect(ev.endTime).toBe('2026-01-15T18:00:00.000Z');
    expect(ev.timezone).toBe('America/New_York');
  });

  it("understands Outlook's Windows zone names and quoted TZIDs", () => {
    const [ev] = parseIcsEvents(ics(lines('SUMMARY:Sync', 'DTSTART;TZID="Pacific Standard Time":20260701T090000')), 'UTC');
    expect(ev.startTime).toBe('2026-07-01T16:00:00.000Z');
    expect(ev.timezone).toBe('America/Los_Angeles');
  });

  it('reads a floating time in the viewer’s zone', () => {
    const [ev] = parseIcsEvents(ics(lines('SUMMARY:Gym', 'DTSTART:20260301T070000', 'DURATION:PT1H30M')), 'Asia/Tokyo');
    expect(ev.startTime).toBe('2026-02-28T22:00:00.000Z');
    expect(ev.endTime).toBe('2026-02-28T23:30:00.000Z');
    expect(ev.timezone).toBe('Asia/Tokyo');
  });

  it('stores an all-day event the way the event form does, with DTEND exclusive', () => {
    const [ev] = parseIcsEvents(ics(lines('SUMMARY:Trip', 'DTSTART;VALUE=DATE:20261102', 'DTEND;VALUE=DATE:20261105')));
    expect(ev).toMatchObject({
      startTime: '2026-11-02T00:00:00Z',
      endTime: '2026-11-04T23:59:59Z',
      allDay: true,
      timezone: null,
    });
  });

  it('makes a one-day all-day event of a date with no end', () => {
    const [ev] = parseIcsEvents(ics(lines('SUMMARY:Birthday', 'DTSTART;VALUE=DATE:20261231')));
    expect(ev.endTime).toBe('2026-12-31T23:59:59Z');
  });

  it('reads every event in the file', () => {
    const events = parseIcsEvents(ics(
      'SUMMARY:One\r\nDTSTART:20261020T160000Z',
      'SUMMARY:Two\r\nDTSTART:20261021T160000Z',
      'SUMMARY:Three\r\nDTSTART:20261022T160000Z',
    ));
    expect(events.map((e) => e.title)).toEqual(['One', 'Two', 'Three']);
  });

  it('unfolds lines, unescapes text, and ignores an alarm’s DESCRIPTION', () => {
    const [ev] = parseIcsEvents(ics(lines(
      'SUMMARY:Review\\, then ship',
      'DESCRIPTION:Line one\\nline t',
      ' wo',
      'LOCATION:Room 4\\; east wing',
      'DTSTART:20261020T160000Z',
      'BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nTRIGGER:-PT15M\r\nEND:VALARM',
      'ATTENDEE;CN="Lee, Sam";RSVP=TRUE:mailto:sam@example.com',
      'ATTENDEE:MAILTO:kim@example.com',
    )));
    expect(ev.title).toBe('Review, then ship');
    expect(ev.description).toBe('Line one\nline two');
    expect(ev.location).toBe('Room 4; east wing');
    expect(ev.attendees).toEqual(['sam@example.com', 'kim@example.com']);
  });

  it('keeps a repeat rule, writing a bare-date UNTIL as the form does', () => {
    const [ev] = parseIcsEvents(ics(lines(
      'SUMMARY:Weekly',
      'DTSTART;TZID=Europe/Paris:20260105T100000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260330',
    )), 'UTC');
    expect(ev.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO;UNTIL=20260330T215959Z');
  });

  it('leaves out cancelled events and edited occurrences of a series in the same file', () => {
    const events = parseIcsEvents(ics(
      'UID:a\r\nSUMMARY:Series\r\nDTSTART:20261020T160000Z\r\nRRULE:FREQ=DAILY;COUNT=5',
      'UID:a\r\nRECURRENCE-ID:20261021T160000Z\r\nSUMMARY:Moved\r\nDTSTART:20261021T170000Z',
      'UID:b\r\nSUMMARY:Off\r\nSTATUS:CANCELLED\r\nDTSTART:20261020T160000Z',
    ));
    expect(events.map((e) => e.title)).toEqual(['Series']);
  });

  it('keeps an edited occurrence that arrives on its own', () => {
    const events = parseIcsEvents(ics('UID:a\r\nRECURRENCE-ID:20261021T160000Z\r\nSUMMARY:Moved\r\nDTSTART:20261021T170000Z'));
    expect(events.map((e) => e.title)).toEqual(['Moved']);
  });

  it('names an untitled event, and skips one with no start', () => {
    const events = parseIcsEvents(ics('DTSTART:20261020T160000Z', 'SUMMARY:No start'));
    expect(events.map((e) => e.title)).toEqual(['Untitled event']);
  });

  it('finds nothing in a file that is not a calendar', () => {
    expect(parseIcsEvents('hello world')).toEqual([]);
  });
});

describe('isIcsFile', () => {
  it('goes by type or extension', () => {
    expect(isIcsFile(new File([''], 'invite.ics'))).toBe(true);
    expect(isIcsFile(new File([''], 'INVITE.ICS'))).toBe(true);
    expect(isIcsFile(new File([''], 'invite', { type: 'text/calendar' }))).toBe(true);
    expect(isIcsFile(new File([''], 'notes.txt', { type: 'text/plain' }))).toBe(false);
  });
});

describe('importIcsFiles', () => {
  beforeEach(() => {
    listEvents.mockReset();
    createEvent.mockReset();
    createEvent.mockImplementation(async (req: { title: string; startTime: string }) => ({ id: req.title, ...req }));
  });

  const file = (text: string) => new File([text], 'cal.ics', { type: 'text/calendar' });

  it('creates every event, and skips one already in the calendar', async () => {
    listEvents.mockResolvedValue({ events: [{ title: 'Two', startTime: '2026-10-21T16:00:00Z' }] });
    const result = await importIcsFiles([file(ics(
      'SUMMARY:One\r\nDTSTART:20261020T160000Z',
      'SUMMARY:Two\r\nDTSTART:20261021T160000Z',
    ))]);
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(createEvent.mock.calls[0][0].title).toBe('One');
    expect(result.added.map((e) => e.title)).toEqual(['One']);
    expect(result.duplicates).toBe(1);
    expect(listEvents).toHaveBeenCalledWith('2026-10-20T16:00:00.000Z', '2026-10-21T16:00:00.000Z');
  });

  it('counts the events the server refused', async () => {
    listEvents.mockResolvedValue({ events: [] });
    createEvent.mockRejectedValueOnce(new Error('nope'));
    const result = await importIcsFiles([file(ics(
      'SUMMARY:One\r\nDTSTART:20261020T160000Z',
      'SUMMARY:Two\r\nDTSTART:20261021T160000Z',
    ))]);
    expect(result.added).toHaveLength(1);
    expect(result.failed).toBe(1);
  });

  it('calls nothing for a file with no events', async () => {
    const result = await importIcsFiles([file('nothing here')]);
    expect(result).toEqual({ added: [], duplicates: 0, failed: 0 });
    expect(listEvents).not.toHaveBeenCalled();
  });
});

describe('describeIcsImport', () => {
  const ev = (title: string) => ({ title } as never);

  it('names a single event', () => {
    expect(describeIcsImport({ added: [ev('Lunch')], duplicates: 0, failed: 0 }))
      .toEqual({ ok: true, message: 'Added “Lunch” to your calendar' });
  });

  it('counts several, with what was skipped or refused', () => {
    expect(describeIcsImport({ added: [ev('a'), ev('b')], duplicates: 1, failed: 2 }).message)
      .toBe('Added 2 events to your calendar · 1 event already there · 2 events could not be added');
  });

  it('says so when everything was already there, or nothing was found, or all failed', () => {
    expect(describeIcsImport({ added: [], duplicates: 3, failed: 0 }))
      .toEqual({ ok: true, message: 'Those events are already in your calendar' });
    expect(describeIcsImport({ added: [], duplicates: 0, failed: 0 }).ok).toBe(false);
    expect(describeIcsImport({ added: [], duplicates: 0, failed: 1 }))
      .toEqual({ ok: false, message: 'Couldn’t add the event to your calendar' });
  });
});
