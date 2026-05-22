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

export function eventsForDay(events: EventResponse[], day: Date): EventResponse[] {
  return events.filter((e) => {
    if (e.allDay) {
      // Avoid UTC→local conversion: compare date parts directly
      const [y, mo, d] = e.startTime.slice(0, 10).split('-').map(Number);
      return y === day.getFullYear() && (mo - 1) === day.getMonth() && d === day.getDate();
    }
    return isSameDay(new Date(e.startTime), day);
  });
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
