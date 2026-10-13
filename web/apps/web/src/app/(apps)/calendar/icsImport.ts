/**
 * An `.ics` file into calendar events: what dropping one onto Calendar or Drive does.
 *
 * Parsing happens in the browser because the file usually never reaches the server as plaintext —
 * a Drive upload is encrypted — and the events are then created through the ordinary
 * `POST /calendar/events`, one per VEVENT, into the default calendar. The stored shape is the
 * event form's: a timed event is a UTC instant plus the IANA zone it was written in, an all-day
 * one is `T00:00:00Z` on its first day to `T23:59:59Z` on its last (an `.ics` DTEND date is
 * exclusive, so the last day is the one before it), and a repeat rule goes through
 * `parseRepeatRule`/`buildRepeatRule` so its UNTIL is written the way every expander reads it.
 */
import { calendarApi, type CreateEventRequest, type EventResponse } from '@neutrino/api-calendar';
import { buildRepeatRule, parseRepeatRule, zonedTimeToUtc } from './repeatRule';

interface Property {
  params: Record<string, string>;
  value: string;
}

interface RawEvent {
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  dtstart?: Property;
  dtend?: Property;
  duration?: string;
  rrule?: string;
  recurrenceId?: string;
  status?: string;
  attendees: string[];
}

/** The common Windows zone names Outlook writes as a TZID, as the IANA zones they mean. */
const WINDOWS_ZONES: Record<string, string> = {
  'Dateline Standard Time': 'Etc/GMT+12',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York',
  'Atlantic Standard Time': 'America/Halifax',
  'Newfoundland Standard Time': 'America/St_Johns',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'UTC': 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'GTB Standard Time': 'Europe/Bucharest',
  'FLE Standard Time': 'Europe/Kiev',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Russian Standard Time': 'Europe/Moscow',
  'Arabian Standard Time': 'Asia/Dubai',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
};

export function isIcsFile(file: File): boolean {
  return file.type === 'text/calendar' || /\.ics$/i.test(file.name);
}

/** The browser's own zone, which a floating time is read in. */
function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * A TZID as an IANA zone, or null when it names none this browser knows. Besides the plain name,
 * that covers Outlook's Windows names and the `/mozilla.org/…/Europe/Paris` prefix older
 * Thunderbird exports carry.
 */
function zoneFor(tzid: string): string | null {
  if (WINDOWS_ZONES[tzid]) return WINDOWS_ZONES[tzid];
  if (isValidZone(tzid)) return tzid;
  const tail = tzid.split('/').filter(Boolean);
  for (let i = 0; i < tail.length - 1; i++) {
    const candidate = tail.slice(i).join('/');
    if (isValidZone(candidate)) return candidate;
  }
  return null;
}

/** Unfolds continuation lines: a line beginning with a space or tab continues the one before. */
function unfold(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if (/^[ \t]/.test(raw) && lines.length > 0) lines[lines.length - 1] += raw.slice(1);
    else if (raw.length > 0) lines.push(raw);
  }
  return lines;
}

/** `NAME;PARAM=a;PARAM2="b:c":value` — the first colon outside quotes ends the name. */
function parseLine(line: string): { name: string; prop: Property } | null {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ':' && !inQuotes) { colon = i; break; }
  }
  if (colon === -1) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"(.*)"$/, '$1');
  }
  return { name: name.toUpperCase(), prop: { params, value: line.slice(colon + 1) } };
}

/** RFC 5545 TEXT unescaping: `\n`, `\,`, `\;` and `\\`. */
function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

function readEvents(text: string): RawEvent[] {
  const events: RawEvent[] = [];
  // Every open component, innermost last, so a VALARM's DESCRIPTION isn't taken for the event's.
  const stack: string[] = [];
  let current: RawEvent | null = null;

  for (const line of unfold(text)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, prop } = parsed;
    if (name === 'BEGIN') {
      const component = prop.value.trim().toUpperCase();
      stack.push(component);
      if (component === 'VEVENT') current = { attendees: [] };
      continue;
    }
    if (name === 'END') {
      const component = stack.pop();
      if (component === 'VEVENT' && current) { events.push(current); current = null; }
      continue;
    }
    if (!current || stack[stack.length - 1] !== 'VEVENT') continue;

    const value = prop.value.trim();
    switch (name) {
      case 'UID': current.uid = value; break;
      case 'SUMMARY': current.summary = unescapeText(value); break;
      case 'DESCRIPTION': current.description = unescapeText(value); break;
      case 'LOCATION': current.location = unescapeText(value); break;
      case 'DTSTART': current.dtstart = { ...prop, value }; break;
      case 'DTEND': current.dtend = { ...prop, value }; break;
      case 'DURATION': current.duration = value; break;
      case 'RRULE': current.rrule = value; break;
      case 'RECURRENCE-ID': current.recurrenceId = value; break;
      case 'STATUS': current.status = value.toUpperCase(); break;
      case 'ATTENDEE': {
        const mailto = /^mailto:(.+)$/i.exec(value);
        if (mailto) current.attendees.push(mailto[1]);
        break;
      }
    }
  }
  return events;
}

type IcsTime =
  | { kind: 'date'; date: string }
  | { kind: 'instant'; ms: number; zone: string };

/** A DTSTART/DTEND as a date (all-day) or an instant with the zone it was written in. */
function readTime(prop: Property, zone: string): IcsTime | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z?))?$/i.exec(prop.value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined || prop.params.VALUE?.toUpperCase() === 'DATE') {
    return { kind: 'date', date: `${y}-${mo}-${d}` };
  }
  const parts = [+y, +mo, +d, +h, +mi, +(s ?? 0)] as const;
  if (z) return { kind: 'instant', ms: Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]), zone };
  // A TZID we can't place is read as a floating time, in the viewer's own zone.
  const tz = (prop.params.TZID && zoneFor(prop.params.TZID)) || zone;
  return { kind: 'instant', ms: zonedTimeToUtc(...parts, tz), zone: tz };
}

/** An RFC 5545 DURATION (`P1W`, `PT1H30M`, `P1DT12H`) in milliseconds, or null. */
function durationMs(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value);
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+(w ?? 0) * 7 + +(d ?? 0)) * 86400 + +(h ?? 0) * 3600 + +(mi ?? 0) * 60 + +(s ?? 0)) * 1000;
  return sign === '-' ? -ms : ms;
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function toRequest(ev: RawEvent, zone: string): CreateEventRequest | null {
  if (!ev.dtstart) return null;
  const start = readTime(ev.dtstart, zone);
  if (!start) return null;
  const end = ev.dtend ? readTime(ev.dtend, zone) : null;
  const duration = ev.duration ? durationMs(ev.duration) : null;

  const fields = {
    title: ev.summary?.trim() || 'Untitled event',
    description: ev.description || null,
    location: ev.location || null,
    attendees: ev.attendees,
  };

  if (start.kind === 'date') {
    // DTEND is exclusive; with neither it nor a DURATION, the event is the one day.
    let last = start.date;
    if (end?.kind === 'date' && end.date > start.date) last = addDays(end.date, -1);
    else if (duration !== null && duration >= 86400000) last = addDays(start.date, Math.ceil(duration / 86400000) - 1);
    return {
      ...fields,
      startTime: `${start.date}T00:00:00Z`,
      endTime: `${last}T23:59:59Z`,
      allDay: true,
      timezone: null,
      recurrenceRule: repeatRule(ev.rrule, { allDay: true, timeZone: zone }),
    };
  }

  let endMs = start.ms;
  if (end?.kind === 'instant' && end.ms >= start.ms) endMs = end.ms;
  else if (duration !== null && duration > 0) endMs = start.ms + duration;
  return {
    ...fields,
    startTime: new Date(start.ms).toISOString(),
    endTime: new Date(endMs).toISOString(),
    allDay: false,
    timezone: start.zone,
    recurrenceRule: repeatRule(ev.rrule, { allDay: false, timeZone: start.zone }),
  };
}

/** The rule as the event form would write it, or as given when the form can't represent it. */
function repeatRule(rrule: string | undefined, ctx: { allDay: boolean; timeZone: string }): string | null {
  if (!rrule) return null;
  const parsed = parseRepeatRule(rrule, ctx);
  return parsed ? buildRepeatRule(parsed, ctx) : rrule;
}

/**
 * Every event in an `.ics` file, ready to create. A cancelled event is left out, and so is an
 * edited occurrence (RECURRENCE-ID) whose series is in the same file — the series stands for it.
 * One on its own, as an invitation update often is, comes in as an ordinary event.
 */
export function parseIcsEvents(text: string, zone: string = localZone()): CreateEventRequest[] {
  const events = readEvents(text).filter((ev) => ev.status !== 'CANCELLED');
  const seriesUids = new Set(events.filter((ev) => !ev.recurrenceId && ev.uid).map((ev) => ev.uid));
  return events
    .filter((ev) => !(ev.recurrenceId && ev.uid && seriesUids.has(ev.uid)))
    .map((ev) => toRequest(ev, zone))
    .filter((req): req is CreateEventRequest => req !== null);
}

export interface IcsImportResult {
  added: EventResponse[];
  /** Already in the calendar: same title, same start. Dropping one file twice adds nothing. */
  duplicates: number;
  failed: number;
}

/** Adds every event in `files` to the default calendar. */
export async function importIcsFiles(files: File[]): Promise<IcsImportResult> {
  const requests = (await Promise.all(files.map(async (f) => parseIcsEvents(await f.text())))).flat();
  const result: IcsImportResult = { added: [], duplicates: 0, failed: 0 };
  if (requests.length === 0) return result;

  const starts = requests.map((r) => r.startTime).sort();
  const ends = requests.map((r) => r.endTime).sort();
  const existing = await calendarApi
    .listEvents(starts[0], ends[ends.length - 1])
    .then((r) => r.events)
    .catch(() => [] as EventResponse[]);
  const keyOf = (title: string, start: string) => `${title}\u0000${new Date(start).getTime()}`;
  const seen = new Set(existing.map((e) => keyOf(e.title, e.startTime)));

  const fresh = requests.filter((r) => {
    const key = keyOf(r.title, r.startTime);
    if (seen.has(key)) { result.duplicates++; return false; }
    seen.add(key);
    return true;
  });

  // One at a time: two creates at once can collide in SQLite ("database is locked") — on a new
  // account both also try to create the default calendar — and the loser is a 500.
  for (const req of fresh) {
    try {
      result.added.push(await calendarApi.createEvent(req));
    } catch {
      result.failed++;
    }
  }
  result.added.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return result;
}

/** What to tell the user, and whether it went wrong. */
export function describeIcsImport(r: IcsImportResult): { ok: boolean; message: string } {
  const n = r.added.length;
  const events = (k: number) => `${k} event${k === 1 ? '' : 's'}`;
  if (n === 0 && r.failed === 0 && r.duplicates === 0) {
    return { ok: false, message: 'No events found in that file' };
  }
  if (n === 0 && r.failed === 0) {
    return { ok: true, message: r.duplicates === 1 ? 'That event is already in your calendar' : 'Those events are already in your calendar' };
  }
  if (n === 0) {
    return { ok: false, message: `Couldn’t add ${r.failed === 1 ? 'the event' : events(r.failed)} to your calendar` };
  }
  const parts = [n === 1 ? `Added “${r.added[0].title}” to your calendar` : `Added ${events(n)} to your calendar`];
  if (r.duplicates > 0) parts.push(`${events(r.duplicates)} already there`);
  if (r.failed > 0) parts.push(`${events(r.failed)} could not be added`);
  return { ok: true, message: parts.join(' · ') };
}
