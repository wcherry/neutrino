import type { EventResponse } from '@/lib/api';
import type { View, ParsedIcsEvent } from './calendarTypes';
import { MONTHS } from './calendarConstants';

// ── Week-view hour-grid helpers ──────────────────────────────────────────────

/** Returns the number of minutes elapsed since midnight (local time) for a given ISO start time. */
export function getEventMinutesFromMidnight(isoString: string): number {
  const d = new Date(isoString);
  return d.getHours() * 60 + d.getMinutes();
}

/** Returns true if the event starts before dayStartHour (local time). */
export function isBeforeDayStart(isoString: string, dayStartHour: number): boolean {
  const d = new Date(isoString);
  return d.getHours() < dayStartHour;
}

/** Returns true if the event starts at or after dayEndHour (local time). */
export function isAfterDayEnd(isoString: string, dayEndHour: number): boolean {
  const d = new Date(isoString);
  return d.getHours() >= dayEndHour;
}

/**
 * Returns the pixel offset from the top of the timed grid for an event.
 * Assumes the grid starts at dayStartHour.
 */
export function getEventTopOffset(isoString: string, dayStartHour: number, hourHeight: number): number {
  const startMinutes = getEventMinutesFromMidnight(isoString);
  return ((startMinutes - dayStartHour * 60) / 60) * hourHeight;
}

/**
 * Returns the pixel height for an event chip, clamped to a minimum of 24px.
 */
export function getEventHeight(startIso: string, endIso: string, hourHeight: number): number {
  const durationMinutes = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000;
  return Math.max(24, (durationMinutes / 60) * hourHeight);
}

// ── End week-view helpers ────────────────────────────────────────────────────

// ── Event form date values ───────────────────────────────────────────────────
// The event modal holds its start and end as the raw value of a `date` or a
// `datetime-local` input — `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` — so these helpers
// work on that wall-clock text rather than on `Date`. Arithmetic goes through
// `Date.UTC`, which keeps a DST boundary from moving the wall-clock time by an
// hour: 09:00 stays 09:00 whichever side of the change the new date lands on.

const FORM_VALUE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2})?)?$/;

interface ParsedFormValue {
  ms: number;
  hasTime: boolean;
}

function parseFormValue(value: string): ParsedFormValue | null {
  const m = FORM_VALUE_RE.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return {
    ms: Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0)),
    hasTime: h !== undefined,
  };
}

function formatFormValue(ms: number, hasTime: boolean): string {
  const d = new Date(ms);
  const p = (n: number) => `${n}`.padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  return hasTime ? `${date}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : date;
}

/**
 * The end value moved by however far the start value moved, so editing the start
 * keeps the event's length instead of leaving the end behind it — issue #129.
 * Either value being unparseable leaves the end alone.
 */
export function shiftEndWithStart(previousStart: string, nextStart: string, end: string): string {
  const before = parseFormValue(previousStart);
  const after = parseFormValue(nextStart);
  const current = parseFormValue(end);
  if (!before || !after || !current) return end;
  const delta = after.ms - before.ms;
  if (delta === 0) return end;
  return formatFormValue(current.ms + delta, current.hasTime);
}

/** The `HH:mm` of a form value, or null when it carries no time. */
export function timeOfFormValue(value: string): string | null {
  const parsed = parseFormValue(value);
  if (!parsed || !parsed.hasTime) return null;
  return formatFormValue(parsed.ms, true).slice(11);
}

/** The same instant as a `date` input's value — the day, with the time dropped. */
export function toAllDayFormValue(value: string): string {
  const parsed = parseFormValue(value);
  return parsed ? formatFormValue(parsed.ms, false) : value;
}

/** The same day as a `datetime-local` input's value, taking `time` if it has none. */
export function toTimedFormValue(value: string, time: string): string {
  const parsed = parseFormValue(value);
  if (!parsed) return value;
  if (parsed.hasTime) return formatFormValue(parsed.ms, true);
  return `${formatFormValue(parsed.ms, false)}T${time}`;
}

export function startOfMonth(y: number, m: number) {
  return new Date(y, m, 1);
}

export function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

export function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function weekStartDate(cursor: Date, startDay: number): Date {
  const d = new Date(cursor);
  const dow = d.getDay();
  const diff = (dow - startDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

export function fmtRangeLabel(view: View, cursor: Date, startDay: number): string {
  if (view === 'month' || view === 'agenda') {
    return `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
  }
  const first = weekStartDate(cursor, startDay);
  const last = new Date(first);
  last.setDate(first.getDate() + 6);
  if (first.getMonth() === last.getMonth()) {
    return `${MONTHS[first.getMonth()]} ${first.getDate()}–${last.getDate()}, ${first.getFullYear()}`;
  }
  return `${MONTHS[first.getMonth()]} ${first.getDate()} – ${MONTHS[last.getMonth()]} ${last.getDate()}, ${first.getFullYear()}`;
}

export function monthRange(cursor: Date): { from: string; to: string } {
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const from = new Date(y, m, 1).toISOString();
  const to = new Date(y, m + 1, 0, 23, 59, 59).toISOString();
  return { from, to };
}

export function buildMonthGrid(cursor: Date, startDay: number): Date[][] {
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = startOfMonth(y, m);
  const firstDow = first.getDay();
  const offset = (firstDow - startDay + 7) % 7;
  const weeks: Date[][] = [];
  let current = new Date(y, m, 1 - offset);
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
    if (current.getMonth() > m || current.getFullYear() > y) break;
  }
  return weeks;
}

// ── RRULE expansion ──────────────────────────────────────────────────────────

interface ParsedRRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  until: Date | null;
  byDay: number[] | null; // 0=Sun..6=Sat
}

function parseRRule(rrule: string): ParsedRRule | null {
  const parts: Record<string, string> = {};
  for (const part of rrule.split(';')) {
    const [k, v] = part.split('=');
    if (k && v !== undefined) parts[k.toUpperCase()] = v;
  }

  const freq = parts['FREQ'] as ParsedRRule['freq'];
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;

  const interval = parts['INTERVAL'] ? parseInt(parts['INTERVAL'], 10) : 1;
  const count = parts['COUNT'] ? parseInt(parts['COUNT'], 10) : null;

  let until: Date | null = null;
  if (parts['UNTIL']) {
    const u = parts['UNTIL'].replace(/[TZ]/g, '').replace(
      /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
      '$1-$2-$3T$4:$5:$6Z'
    );
    until = new Date(u.length > 10 ? u : u.slice(0, 8) + 'T00:00:00Z');
  }

  const DAY_MAP: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const byDay = parts['BYDAY']
    ? parts['BYDAY'].split(',').map((d) => DAY_MAP[d.replace(/[+-\d]/g, '')]).filter((n) => !isNaN(n))
    : null;

  return { freq, interval, count, until, byDay };
}

function advanceDate(d: Date, rule: ParsedRRule): void {
  switch (rule.freq) {
    case 'DAILY':   d.setDate(d.getDate() + rule.interval); break;
    case 'WEEKLY':  d.setDate(d.getDate() + 7 * rule.interval); break;
    case 'MONTHLY': d.setMonth(d.getMonth() + rule.interval); break;
    case 'YEARLY':  d.setFullYear(d.getFullYear() + rule.interval); break;
  }
}

export function expandRecurringEvents(events: EventResponse[], from: Date, to: Date): EventResponse[] {
  const result: EventResponse[] = [];

  for (const ev of events) {
    if (!ev.recurrenceRule) {
      result.push(ev);
      continue;
    }

    const rule = parseRRule(ev.recurrenceRule);
    if (!rule) {
      result.push(ev);
      continue;
    }

    const dtStart = new Date(ev.startTime);
    const dtEnd = new Date(ev.endTime);
    const duration = dtEnd.getTime() - dtStart.getTime();

    // For WEEKLY+BYDAY, generate occurrences per specified day-of-week within each weekly interval
    const current = new Date(dtStart);
    let count = 0;
    const MAX_OCCURRENCES = 1000;

    while (current <= to && count < MAX_OCCURRENCES) {
      if (rule.count !== null && count >= rule.count) break;
      if (rule.until && current > rule.until) break;

      const daysToCheck =
        rule.freq === 'WEEKLY' && rule.byDay
          ? rule.byDay
          : [current.getDay()];

      for (const targetDay of daysToCheck) {
        const occ = new Date(current);
        const diff = ((targetDay - occ.getDay()) + 7) % 7;
        occ.setDate(occ.getDate() + diff);

        if (occ < dtStart) continue;
        if (occ > to) continue;
        if (rule.until && occ > rule.until) continue;

        if (occ >= from) {
          const occEnd = new Date(occ.getTime() + duration);
          result.push({
            ...ev,
            startTime: occ.toISOString(),
            endTime: occEnd.toISOString(),
          });
        }
      }

      advanceDate(current, rule);
      count++;
    }
  }

  return result;
}

// ── Multi-day events ─────────────────────────────────────────────────────────
// An event covers every day between its start and its end, not just the day it
// begins on — issue #130. All of this works in whole local days: an event is
// either on a given day or it isn't, whatever time of day it starts.

export function startOfDay(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate());
}

/** Local midnight of an ISO string's date part — no UTC→local conversion. */
function dateOnly(iso: string): Date {
  const [y, mo, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, mo - 1, d);
}

function addDays(day: Date, n: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);
}

/**
 * The first and last local day an event occupies, both inclusive, as midnights.
 *
 * An end that lands exactly on midnight belongs to the day before it: that is
 * what an `.ics` all-day `DTEND` means (it is exclusive), and a timed event
 * ending at 00:00 has nothing on the day it names either.
 */
export function eventDayRange(ev: EventResponse): { first: Date; last: Date } {
  const endsAtMidnight = ev.allDay
    ? ev.endTime.slice(11, 19) === '00:00:00'
    : (() => { const e = new Date(ev.endTime); return e.getHours() === 0 && e.getMinutes() === 0 && e.getSeconds() === 0; })();

  const first = ev.allDay ? dateOnly(ev.startTime) : startOfDay(new Date(ev.startTime));
  let last = ev.allDay ? dateOnly(ev.endTime) : startOfDay(new Date(ev.endTime));

  if (last.getTime() > first.getTime() && endsAtMidnight) last = addDays(last, -1);
  if (last.getTime() < first.getTime()) last = first;
  return { first, last };
}

export function eventOccupiesDay(ev: EventResponse, day: Date): boolean {
  const { first, last } = eventDayRange(ev);
  const t = startOfDay(day).getTime();
  return t >= first.getTime() && t <= last.getTime();
}

/**
 * Pixel top and height for the part of an event that falls on `day`, clamped to
 * that day — a multi-day event fills the column on the days in between rather
 * than running off the bottom of the one it started on.
 */
export function getEventDayBounds(
  ev: EventResponse,
  day: Date,
  hourHeight: number,
): { top: number; height: number } {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(day, 1).getTime();
  const start = Math.max(new Date(ev.startTime).getTime(), dayStart);
  const end = Math.min(new Date(ev.endTime).getTime(), dayEnd);
  return {
    top: ((start - dayStart) / 3_600_000) * hourHeight,
    height: Math.max(24, ((end - start) / 3_600_000) * hourHeight),
  };
}

/** One event's run across one week row of the month grid. */
export interface WeekEventSegment {
  event: EventResponse;
  /** Stable across renders; an event id alone is not, since occurrences share one. */
  key: string;
  /** Column (0-6) the bar starts in, and how many columns it covers. */
  startIndex: number;
  span: number;
  /** The event runs on past this week row's edge, so the bar is cut square there. */
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** Row within the week's cells; bars in the same lane never overlap. */
  lane: number;
}

/**
 * Lays every event that touches `week` out as one bar per week row, so a
 * multi-day event is a single widget covering its days rather than a chip on
 * the first one — issue #130.
 */
export function buildWeekEventSegments(events: EventResponse[], week: Date[]): WeekEventSegment[] {
  const dayTimes = week.map((d) => startOfDay(d).getTime());
  if (dayTimes.length === 0) return [];

  const placed: Omit<WeekEventSegment, 'lane'>[] = [];
  for (const ev of events) {
    const { first, last } = eventDayRange(ev);
    const startIndex = dayTimes.findIndex((t) => t >= first.getTime());
    if (startIndex === -1) continue;
    let endIndex = -1;
    for (let i = dayTimes.length - 1; i >= 0; i--) {
      if (dayTimes[i] <= last.getTime()) { endIndex = i; break; }
    }
    if (endIndex < startIndex) continue;

    placed.push({
      event: ev,
      key: `${ev.id}-${ev.startTime}-${dayTimes[startIndex]}`,
      startIndex,
      span: endIndex - startIndex + 1,
      continuesBefore: first.getTime() < dayTimes[0],
      continuesAfter: last.getTime() > dayTimes[dayTimes.length - 1],
    });
  }

  // Longest first so a bar spanning the week sits above the single days it
  // crosses, which is what keeps a week row from looking like a staircase.
  placed.sort((a, b) =>
    a.startIndex - b.startIndex ||
    b.span - a.span ||
    a.event.startTime.localeCompare(b.event.startTime) ||
    a.event.title.localeCompare(b.event.title));

  const lanes: boolean[][] = [];
  return placed.map((seg) => {
    let lane = 0;
    for (;;) {
      if (!lanes[lane]) lanes[lane] = new Array<boolean>(week.length).fill(false);
      const free = lanes[lane].slice(seg.startIndex, seg.startIndex + seg.span).every((taken) => !taken);
      if (free) break;
      lane++;
    }
    for (let i = seg.startIndex; i < seg.startIndex + seg.span; i++) lanes[lane][i] = true;
    return { ...seg, lane };
  });
}

export function eventsForDay(events: EventResponse[], day: Date): EventResponse[] {
  return events.filter((e) => eventOccupiesDay(e, day));
}

export function isOverdue(dueTime: string) {
  return new Date(dueTime) < new Date();
}

export function icsDateToIso(val: string): string {
  if (val.length === 8) {
    return `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}T00:00:00Z`;
  }
  const y = val.slice(0, 4), mo = val.slice(4, 6), d = val.slice(6, 8);
  const h = val.slice(9, 11) || '00', mi = val.slice(11, 13) || '00', s = val.slice(13, 15) || '00';
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

export function parseIcs(text: string): ParsedIcsEvent | null {
  const lines: string[] = [];
  // Unfold continuation lines
  for (const raw of text.split(/\r?\n/)) {
    if (/^[ \t]/.test(raw) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
    } else {
      lines.push(raw);
    }
  }

  let inEvent = false;
  const ev: ParsedIcsEvent = { attendees: [] };

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { inEvent = true; continue; }
    if (line === 'END:VEVENT') { break; }
    if (!inEvent) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).toUpperCase();
    const val = line.slice(colon + 1).trim();

    if (key === 'SUMMARY') ev.title = val;
    else if (key === 'DESCRIPTION') ev.description = val.replace(/\\n/g, '\n');
    else if (key === 'LOCATION') ev.location = val;
    else if (key.startsWith('DTSTART')) {
      ev.allDay = key.includes('VALUE=DATE') || val.length === 8;
      ev.startTime = icsDateToIso(val);
    } else if (key.startsWith('DTEND')) {
      ev.endTime = icsDateToIso(val);
    } else if (key.startsWith('ATTENDEE')) {
      const mailto = val.match(/mailto:(.+)/i);
      if (mailto) ev.attendees!.push(mailto[1]);
    }
  }

  return ev.title ? ev : null;
}
