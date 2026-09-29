/**
 * An event's RRULE as the event form edits it: how often (FREQ and INTERVAL — "every 3 days")
 * and when it stops (never, on a date, or after a number of occurrences).
 *
 * The iOS app's `RepeatRule.swift` is a port of this file, and both are held to
 * `repeatRuleFixtures.json`: they must write the same strings, because each client expands the
 * other's rules.
 *
 * What gets written:
 *
 *     FREQ=WEEKLY[;INTERVAL=n][;BYDAY=…][;any other part, as it was][;COUNT=n | ;UNTIL=…]
 *
 * - INTERVAL only when it isn't 1, so the plain choices stay the strings `REPEAT_OPTIONS` has.
 * - UNTIL is always a UTC date-time: every expander in the platform (both clients and the
 *   server's `calendar::recurrence`) ignores a bare date. For a timed event it is the last
 *   second of the chosen day in the event's zone; for an all-day event it is `T235959Z`, the
 *   form the all-day end itself is stored in.
 * - A rule this can't represent faithfully — no or unknown FREQ, a part without `=`, an
 *   INTERVAL or COUNT that isn't a positive number, both COUNT and UNTIL — parses to null, and
 *   the form leaves it exactly as it was.
 */

export type RepeatFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export type RepeatEnd =
  | { kind: 'never' }
  /** The last day an occurrence may fall on, `yyyy-mm-dd`, inclusive. */
  | { kind: 'on'; date: string }
  | { kind: 'after'; count: number };

export interface RepeatRule {
  freq: RepeatFrequency;
  interval: number;
  /** BYDAY as written, e.g. `MO,TU,WE,TH,FR`. */
  byDay: string | null;
  end: RepeatEnd;
  /** Every other part (BYMONTHDAY, WKST…), as written, in order. */
  extra: string[];
}

/** Whether the event is all-day, and the IANA zone its times are entered in. */
export interface RepeatContext {
  allDay: boolean;
  timeZone: string;
}

export const WEEKDAYS_BYDAY = 'MO,TU,WE,TH,FR';
export const MAX_REPEAT_NUMBER = 999;

const FREQUENCIES: RepeatFrequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

export function parseRepeatRule(rule: string, ctx: RepeatContext): RepeatRule | null {
  let freq: RepeatFrequency | null = null;
  let interval = 1;
  let byDay: string | null = null;
  let count: number | null = null;
  let until: string | null = null;
  const extra: string[] = [];

  for (const part of rule.split(';')) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    if (eq <= 0) return null;
    const key = part.slice(0, eq).toUpperCase();
    const value = part.slice(eq + 1);
    switch (key) {
      case 'FREQ':
        if (!FREQUENCIES.includes(value.toUpperCase() as RepeatFrequency)) return null;
        freq = value.toUpperCase() as RepeatFrequency;
        break;
      case 'INTERVAL': {
        const n = positive(value);
        if (n === null) return null;
        interval = n;
        break;
      }
      case 'COUNT':
        count = positive(value);
        if (count === null) return null;
        break;
      case 'UNTIL':
        until = untilDate(value, ctx);
        if (until === null) return null;
        break;
      case 'BYDAY':
        byDay = value.toUpperCase();
        break;
      default:
        extra.push(part);
    }
  }
  if (freq === null || (count !== null && until !== null)) return null;

  const end: RepeatEnd =
    count !== null ? { kind: 'after', count }
      : until !== null ? { kind: 'on', date: until }
        : { kind: 'never' };
  return { freq, interval, byDay, end, extra };
}

export function buildRepeatRule(rule: RepeatRule, ctx: RepeatContext): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay) parts.push(`BYDAY=${rule.byDay}`);
  parts.push(...rule.extra);
  if (rule.end.kind === 'after') parts.push(`COUNT=${rule.end.count}`);
  if (rule.end.kind === 'on') parts.push(`UNTIL=${untilValue(rule.end.date, ctx)}`);
  return parts.join(';');
}

// ── The form's choices ──────────────────────────────────────────────────────

/**
 * The `REPEAT_OPTIONS` value a rule is shown under: its FREQ, or the weekday choice. A weekly
 * rule on other days ("every Mon and Thu", from Smart Add) shows as Weekly and keeps its days.
 */
export function repeatPreset(rule: RepeatRule): string {
  return rule.freq === 'WEEKLY' && rule.byDay === WEEKDAYS_BYDAY
    ? `FREQ=WEEKLY;BYDAY=${WEEKDAYS_BYDAY}`
    : `FREQ=${rule.freq}`;
}

/**
 * `rule` after picking `preset` (a `REPEAT_OPTIONS` value; `''` for none). Picking the choice it
 * already shows changes nothing; picking another keeps the interval and the end, and drops the
 * days and any other parts, which belonged to the old frequency.
 */
export function withRepeatPreset(rule: RepeatRule | null, preset: string): RepeatRule | null {
  if (!preset) return null;
  if (rule && repeatPreset(rule) === preset) return rule;
  const weekdays = preset === `FREQ=WEEKLY;BYDAY=${WEEKDAYS_BYDAY}`;
  return {
    freq: preset.slice('FREQ='.length).split(';')[0] as RepeatFrequency,
    interval: rule?.interval ?? 1,
    byDay: weekdays ? WEEKDAYS_BYDAY : null,
    end: rule?.end ?? { kind: 'never' },
    extra: [],
  };
}

/** A sensible end date to offer when the user picks "On date": a month or a year after `start`. */
export function defaultRepeatEndDate(start: string, freq: RepeatFrequency): string {
  const [y, m, d] = start.slice(0, 10).split('-').map(Number);
  const date = freq === 'MONTHLY' || freq === 'YEARLY'
    ? new Date(Date.UTC(y + 1, m - 1, d))
    : new Date(Date.UTC(y, m, d));
  return date.toISOString().slice(0, 10);
}

export function repeatUnit(freq: RepeatFrequency, interval: number): string {
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[freq];
  return interval === 1 ? unit : `${unit}s`;
}

// ── UNTIL ───────────────────────────────────────────────────────────────────

function positive(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 ? n : null;
}

/** An UNTIL value as the day it ends on, or null when it isn't one. */
function untilDate(value: string, ctx: RepeatContext): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/i.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  // A bare date, or a floating date-time: the day as written.
  if (h === undefined || !z || ctx.allDay) return `${y}-${mo}-${d}`;
  return dayInZone(new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), ctx.timeZone);
}

function untilValue(date: string, ctx: RepeatContext): string {
  const [y, m, d] = date.split('-').map(Number);
  if (ctx.allDay) return `${date.replace(/-/g, '')}T235959Z`;
  // The last second of the day in the event's zone. The zone's offset at a UTC guess, then again
  // at the answer, since a DST change can fall between the two.
  const target = Date.UTC(y, m - 1, d, 23, 59, 59);
  let instant = target - offsetMs(target, ctx.timeZone);
  instant = target - offsetMs(instant, ctx.timeZone);
  return new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** How far `timeZone`'s wall clock is ahead of UTC at `instant`. */
function offsetMs(instant: number, timeZone: string): number {
  const p = zonedParts(new Date(instant), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}

function dayInZone(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}
