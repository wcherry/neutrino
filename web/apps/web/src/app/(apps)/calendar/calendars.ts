// Calendars on the client: colours, visibility, read-only, and the days of holiday calendars.
// See `agent_docs/calendars.md`.

import type { CSSProperties } from 'react';
import type { CalendarResponse, EventResponse } from '@neutrino/api-calendar';

/** The colours offered for a new calendar, and the first one a holiday calendar gets. */
export const CALENDAR_COLORS = [
  '#3b82f6', '#16a34a', '#f97316', '#8b5cf6', '#e11d48', '#0ea5e9', '#ca8a04', '#64748b',
] as const;

/** The `source` of a holiday event, which no stored event has. */
export const HOLIDAY_SOURCE = 'holidays';

export type CalendarMap = ReadonlyMap<string, CalendarResponse>;

export function calendarMap(calendars: readonly CalendarResponse[]): CalendarMap {
  return new Map(calendars.map((c) => [c.id, c]));
}

/** The calendar an event is in, if it is one the user has. */
export function calendarOf(event: EventResponse, calendars: CalendarMap): CalendarResponse | undefined {
  return event.calendarId ? calendars.get(event.calendarId) : undefined;
}

/**
 * The events to draw: those in a calendar that is shown. An event in no calendar the client
 * knows of is shown, so nothing disappears while the calendar list is still loading.
 */
export function visibleEvents<E extends EventResponse>(events: readonly E[], calendars: CalendarMap): E[] {
  return events.filter((e) => calendarOf(e, calendars)?.visible !== false);
}

/** Whether the event can't be edited, moved or deleted: a holiday, or one in a read-only calendar. */
export function isReadOnlyEvent(event: EventResponse, calendars: CalendarMap): boolean {
  return event.source === HOLIDAY_SOURCE || calendarOf(event, calendars)?.readOnly === true;
}

/** The calendars a new or moved event can go in. */
export function writableCalendars(calendars: readonly CalendarResponse[]): CalendarResponse[] {
  return calendars.filter((c) => !c.readOnly);
}

/**
 * Inline custom properties that draw an event in its calendar's colour. The view's CSS reads
 * `--event-bg`, `--event-fg` and `--event-solid` and falls back to the primary colour, so an
 * event with no known calendar looks as every event did before calendars.
 */
export function eventColorStyle(color: string | undefined): CSSProperties | undefined {
  if (!color) return undefined;
  return {
    '--event-solid': color,
    '--event-bg': `color-mix(in srgb, ${color} 20%, var(--color-surface, #fff))`,
    '--event-fg': `color-mix(in srgb, ${color} 70%, var(--color-text-primary, #111827))`,
  } as CSSProperties;
}

// ── Holidays ──────────────────────────────────────────────────────────────────
//
// A holiday calendar stores only its settings; its days are computed here from the
// `date-holidays` rules, so they work offline and no third party learns which countries a user
// picked. The library and its data are large, so they load only when a holiday calendar is shown
// or the settings list countries.

/** `date-holidays` types shown as holidays; observances add the rest but `school`. */
const PUBLIC_TYPES = new Set(['public', 'bank']);
const OBSERVANCE_TYPES = new Set(['optional', 'observance']);

interface HolidayRecord {
  /** Local to the country: `YYYY-MM-DD hh:mm:ss`. */
  date: string;
  start: Date;
  end: Date;
  name: string;
  type: string;
}

interface HolidaysLib {
  getHolidays(year: number, lang?: string): HolidayRecord[] | false;
  getCountries(lang?: string): Record<string, string>;
  getStates(country: string, lang?: string): Record<string, string> | undefined;
}

type HolidaysCtor = new (country?: string, state?: string) => HolidaysLib;

let library: Promise<HolidaysCtor> | null = null;

export function loadHolidaysLibrary(): Promise<HolidaysCtor> {
  library ??= import('date-holidays').then((m) => (m.default ?? m) as unknown as HolidaysCtor);
  return library;
}

/**
 * The language holiday names are given in: the browser's, if the rules have it. The full tag,
 * not just the language: `en-US` names a US holiday "Labor Day" where `en` says "Labour Day".
 */
export function holidayLanguage(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.language || undefined;
}

/** Every country the rules know, by name. */
export async function holidayCountries(lang = holidayLanguage()): Promise<{ code: string; name: string }[]> {
  const Holidays = await loadHolidaysLibrary();
  const names = new Holidays().getCountries(lang);
  return Object.entries(names)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The regions of `country` that have holidays of their own; empty when it has none. */
export async function holidayRegions(country: string, lang = holidayLanguage()): Promise<{ code: string; name: string }[]> {
  const Holidays = await loadHolidaysLibrary();
  const names = new Holidays().getStates(country, lang) ?? {};
  return Object.entries(names)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const dayMs = 86_400_000;

function addDaysIso(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * The holidays of `calendar` from `from` to `to` (inclusive, ISO instants), as all-day events in
 * it. All-day events are dated by their UTC date, `T00:00:00Z` to `T23:59:59Z` of the last day.
 */
export function holidaysOf(
  Holidays: HolidaysCtor,
  calendar: CalendarResponse,
  from: string,
  to: string,
  /** Absent, the country's own language. */
  lang?: string,
): EventResponse[] {
  if (calendar.kind !== 'holidays' || !calendar.country) return [];
  const rules = new Holidays(calendar.country, calendar.region ?? undefined);
  const first = from.slice(0, 10);
  const last = to.slice(0, 10);
  const events: EventResponse[] = [];
  const seen = new Set<string>();
  for (let year = Number(first.slice(0, 4)); year <= Number(last.slice(0, 4)); year++) {
    for (const h of rules.getHolidays(year, lang) || []) {
      const shown = PUBLIC_TYPES.has(h.type) || (calendar.includeObservances && OBSERVANCE_TYPES.has(h.type));
      if (!shown) continue;
      const day = h.date.slice(0, 10);
      // Most holidays are a day; an evening one (Halloween's starts at 18:00) is still its day.
      const days = Math.max(1, Math.round((h.end.getTime() - h.start.getTime()) / dayMs));
      const lastDay = addDaysIso(day, days - 1);
      if (lastDay < first || day > last) continue;
      const id = `holiday:${calendar.id}:${day}:${h.name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      events.push({
        id,
        title: h.name,
        description: null,
        startTime: `${day}T00:00:00Z`,
        endTime: `${lastDay}T23:59:59Z`,
        allDay: true,
        location: null,
        recurrenceRule: null,
        attendees: [],
        source: HOLIDAY_SOURCE,
        createdAt: calendar.createdAt,
        updatedAt: calendar.updatedAt,
        timezone: null,
        calendarId: calendar.id,
      });
    }
  }
  return events;
}

/** The holidays of every shown holiday calendar in the range. Loads the rules only if needed. */
export async function holidayEvents(
  calendars: readonly CalendarResponse[],
  from: string,
  to: string,
  lang = holidayLanguage(),
): Promise<EventResponse[]> {
  const shown = calendars.filter((c) => c.kind === 'holidays' && c.visible);
  if (shown.length === 0) return [];
  const Holidays = await loadHolidaysLibrary();
  return shown.flatMap((c) => holidaysOf(Holidays, c, from, to, lang));
}
