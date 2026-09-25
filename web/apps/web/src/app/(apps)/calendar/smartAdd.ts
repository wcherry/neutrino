/**
 * RTM-style Smart Add: one typed line becomes a task and its fields.
 *
 *   Buy milk ^tomorrow 5pm !1 #errands *weekly =15min ~today @Safeway // semi-skimmed
 *
 * | Token        | Field                  | Examples                                          |
 * |--------------|------------------------|---------------------------------------------------|
 * | `^date`      | due                    | ^tomorrow, ^fri 3pm, ^oct 3, ^in 2 weeks, ^eom    |
 * | `~date`      | start                  | ~today, ~next mon                                 |
 * | `!1`–`!3`    | priority               | !1 (high) … !3 (low)                              |
 * | `#word`      | tag                    | #errands (lowercased)                             |
 * | `*repeat`    | repeat (an RRULE)      | *daily, *every mon and thu, *every other week, *after 2 weeks, *weekly for 4 times |
 * | `=estimate`  | time estimate          | =15min, =1h30m, =2 hours                          |
 * | `@place`     | location               | @Safeway                                          |
 * | `// text`    | note (rest of the line)| // semi-skimmed                                   |
 *
 * A date phrase with no `^` is also the due date — "call mom tomorrow 3pm", "pay rent by
 * friday" — as long as it reads unambiguously as a date: an abbreviation that is also a word
 * ("tom", "sat", "mon"), a bare ordinal or a slash date needs `^` or a leading on/by/due. Text in
 * double quotes is never parsed, which is the escape for a title that happens to contain a date.
 *
 * The iOS Calendar app has a Swift port of this file (`SmartAdd.swift`), and both are tested
 * against `smartAddFixtures.json` — change the grammar in both, and add the case to the fixtures.
 */

import type { CreateTaskRequest } from '@neutrino/api-calendar';

export interface SmartDate {
  /** A calendar date, `YYYY-MM-DD`, in the user's own zone. */
  date: string;
  /** `HH:MM`, 24-hour, or null for a date with no time. */
  time: string | null;
}

export interface SmartAddResult {
  title: string;
  due: SmartDate | null;
  start: SmartDate | null;
  priority: 1 | 2 | 3 | null;
  /** Lowercase, without '#', in the order typed, no repeats. */
  tags: string[];
  /** An RRULE body the server's `calendar::recurrence` steps, e.g. `FREQ=WEEKLY;BYDAY=MO,TH`. */
  recurrenceRule: string | null;
  repeatAfterCompletion: boolean;
  estimateMinutes: number | null;
  location: string | null;
  note: string | null;
}

/** What "today" and "now" are, in the user's zone. Passed in so parsing is a pure function. */
export interface SmartAddContext {
  /** `YYYY-MM-DD` */
  today: string;
  /** `HH:MM` */
  now: string;
}

export function smartAddContext(at: Date = new Date()): SmartAddContext {
  return {
    today: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    now: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  };
}

// ── Calendar arithmetic on plain dates ──────────────────────────────────────

interface YMD {
  y: number;
  m: number;
  d: number;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatYMD(x: YMD): string {
  return `${x.y}-${pad(x.m)}-${pad(x.d)}`;
}

function parseYMD(s: string): YMD {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addDays(x: YMD, n: number): YMD {
  const dt = new Date(Date.UTC(x.y, x.m - 1, x.d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** Months clamp to the end of a shorter month: Jan 31 + 1 month is Feb 28. */
function addMonths(x: YMD, n: number): YMD {
  const total = x.y * 12 + (x.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { y, m, d: Math.min(x.d, daysInMonth(y, m)) };
}

/** 0 = Sunday … 6 = Saturday */
function weekdayOf(x: YMD): number {
  return new Date(Date.UTC(x.y, x.m - 1, x.d)).getUTCDay();
}

function compareYMD(a: YMD, b: YMD): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

function isValidDate(y: number, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** The first `weekday` on or after `from`. */
function onOrAfter(from: YMD, weekday: number): YMD {
  return addDays(from, (weekday - weekdayOf(from) + 7) % 7);
}

// ── Vocabulary ──────────────────────────────────────────────────────────────

/**
 * A table read that only sees the table's own keys. These are plain objects, and without this
 * `WEEKDAYS['constructor']` is `Object.prototype.constructor` — so "^constructor" was a date.
 */
function lookup<T>(table: Record<string, T>, key: string | undefined): T | undefined {
  return key !== undefined && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** Full names are unambiguous; the abbreviations are also words ("sat", "sun", "wed"). */
const WEEKDAYS: Record<string, { day: number; strong: boolean }> = {
  sunday: { day: 0, strong: true }, sun: { day: 0, strong: false },
  monday: { day: 1, strong: true }, mon: { day: 1, strong: false },
  tuesday: { day: 2, strong: true }, tue: { day: 2, strong: false }, tues: { day: 2, strong: false },
  wednesday: { day: 3, strong: true }, wed: { day: 3, strong: false },
  thursday: { day: 4, strong: true }, thu: { day: 4, strong: false },
  thur: { day: 4, strong: false }, thurs: { day: 4, strong: false },
  friday: { day: 5, strong: true }, fri: { day: 5, strong: false },
  saturday: { day: 6, strong: true }, sat: { day: 6, strong: false },
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

type Unit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

const UNITS: Record<string, Unit> = {
  min: 'minute', mins: 'minute', minute: 'minute', minutes: 'minute',
  h: 'hour', hr: 'hour', hrs: 'hour', hour: 'hour', hours: 'hour',
  day: 'day', days: 'day', week: 'week', weeks: 'week', wk: 'week', wks: 'week',
  month: 'month', months: 'month', year: 'year', years: 'year', yr: 'year', yrs: 'year',
};

const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Words that may introduce an un-prefixed date and are dropped from the title with it. */
const CONNECTORS = new Set(['on', 'by', 'due']);

// ── Date phrases ────────────────────────────────────────────────────────────

interface DatePart {
  ymd: YMD;
  /** Set by "in 2 hours", which names a time as well as a date. */
  time?: string;
  n: number;
  strong: boolean;
}

interface TimePart {
  time: string;
  n: number;
  strong: boolean;
}

function parseCount(word: string | undefined): number | null {
  if (word === undefined) return null;
  if (word === 'a' || word === 'an' || word === 'one') return 1;
  return /^\d{1,4}$/.test(word) ? Number(word) : null;
}

function parseOrdinal(word: string | undefined): number | null {
  const m = word?.match(/^(\d{1,2})(st|nd|rd|th)?$/);
  return m ? Number(m[1]) : null;
}

/** Monday of the week after `today`'s (weeks start on Monday). */
function nextWeekStart(today: YMD): YMD {
  return addDays(today, 7 - ((weekdayOf(today) + 6) % 7));
}

function datePart(w: string[], j: number, today: YMD, now: string): DatePart | null {
  const a = w[j];
  const b = w[j + 1];
  if (a === undefined) return null;

  if (a === 'today' || a === 'tonight') return { ymd: today, n: 1, strong: true };
  if (a === 'tod') return { ymd: today, n: 1, strong: false };
  if (a === 'tomorrow' || a === 'tmrw') return { ymd: addDays(today, 1), n: 1, strong: true };
  if (a === 'tom' || a === 'tmr') return { ymd: addDays(today, 1), n: 1, strong: false };
  if (a === 'day' && b === 'after' && w[j + 2] === 'tomorrow') {
    return { ymd: addDays(today, 2), n: 3, strong: true };
  }
  if (a === 'eom') return { ymd: { ...today, d: daysInMonth(today.y, today.m) }, n: 1, strong: true };
  if (a === 'end' && b === 'of') {
    const k = w[j + 2] === 'the' ? j + 3 : j + 2;
    if (w[k] === 'month') {
      return { ymd: { ...today, d: daysInMonth(today.y, today.m) }, n: k - j + 1, strong: true };
    }
  }

  if (a === 'this' || a === 'next') {
    const wd = lookup(WEEKDAYS, b);
    if (wd) {
      const ymd = a === 'this'
        ? onOrAfter(today, wd.day)
        : addDays(nextWeekStart(today), (wd.day + 6) % 7);
      return { ymd, n: 2, strong: true };
    }
    if (a === 'next') {
      if (b === 'week') return { ymd: addDays(today, 7), n: 2, strong: true };
      if (b === 'month') return { ymd: addMonths(today, 1), n: 2, strong: true };
      if (b === 'year') return { ymd: addMonths(today, 12), n: 2, strong: true };
    }
    return null;
  }

  const wd = lookup(WEEKDAYS, a);
  if (wd) return { ymd: onOrAfter(today, wd.day), n: 1, strong: wd.strong };

  // "in 3 days", "in a week", "in 2 hours"; "3 days" without "in" only when prefixed.
  const hasIn = a === 'in';
  const count = parseCount(hasIn ? b : a);
  const unit = lookup(UNITS, hasIn ? w[j + 2] : b);
  if (count !== null && unit && (hasIn || (a !== 'a' && a !== 'an' && a !== 'one'))) {
    const n = hasIn ? 3 : 2;
    const strong = hasIn;
    switch (unit) {
      case 'day': return { ymd: addDays(today, count), n, strong };
      case 'week': return { ymd: addDays(today, 7 * count), n, strong };
      case 'month': return { ymd: addMonths(today, count), n, strong };
      case 'year': return { ymd: addMonths(today, 12 * count), n, strong };
      default: {
        const [h, mi] = now.split(':').map(Number);
        const total = h * 60 + mi + count * (unit === 'hour' ? 60 : 1);
        const days = Math.floor(total / 1440);
        const rest = total % 1440;
        return {
          ymd: addDays(today, days),
          time: `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`,
          n,
          strong,
        };
      }
    }
  }

  // 2026-10-03
  const iso = a.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return isValidDate(y, m, d) ? { ymd: { y, m, d }, n: 1, strong: true } : null;
  }

  // 10/3, 10/3/27, 10/3/2027 — month first.
  const slash = a.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
  if (slash) {
    const m = Number(slash[1]);
    const d = Number(slash[2]);
    const y = slash[3] ? (slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])) : undefined;
    const ymd = resolveMonthDay(m, d, y, today);
    return ymd ? { ymd, n: 1, strong: false } : null;
  }

  // "oct 3", "october 3rd", "oct 3 2027"
  const month = lookup(MONTHS, a);
  if (month !== undefined) {
    const d = parseOrdinal(b);
    if (d === null) return null;
    const year = w[j + 2]?.match(/^\d{4}$/) ? Number(w[j + 2]) : undefined;
    const ymd = resolveMonthDay(month, d, year, today);
    return ymd ? { ymd, n: year !== undefined ? 3 : 2, strong: true } : null;
  }

  // "3 oct", "3rd of october", "the 15th"
  const skipThe = a === 'the' ? 1 : 0;
  const day = parseOrdinal(w[j + skipThe]);
  if (day !== null) {
    let k = j + skipThe + 1;
    if (w[k] === 'of') k += 1;
    const m = lookup(MONTHS, w[k]);
    if (m !== undefined) {
      const year = w[k + 1]?.match(/^\d{4}$/) ? Number(w[k + 1]) : undefined;
      const ymd = resolveMonthDay(m, day, year, today);
      return ymd ? { ymd, n: k - j + 1 + (year !== undefined ? 1 : 0), strong: true } : null;
    }
    // A day of the month on its own: this month's, or next month's once it has passed.
    const ordinalWord = w[j + skipThe];
    if (/\d(st|nd|rd|th)$/.test(ordinalWord) && day >= 1 && day <= 31) {
      let candidate: YMD | null = null;
      for (let i = 0; i < 12 && !candidate; i++) {
        const base = addMonths({ ...today, d: 1 }, i);
        if (day <= daysInMonth(base.y, base.m) && compareYMD({ ...base, d: day }, today) >= 0) {
          candidate = { ...base, d: day };
        }
      }
      return candidate ? { ymd: candidate, n: skipThe + 1, strong: false } : null;
    }
  }

  return null;
}

/** A month and day with no year is the next one on or after today. */
function resolveMonthDay(m: number, d: number, y: number | undefined, today: YMD): YMD | null {
  if (y !== undefined) return isValidDate(y, m, d) ? { y, m, d } : null;
  for (const year of [today.y, today.y + 1, today.y + 2, today.y + 3, today.y + 4]) {
    if (isValidDate(year, m, d) && compareYMD({ y: year, m, d }, today) >= 0) return { y: year, m, d };
  }
  return null;
}

function timePart(w: string[], j: number): TimePart | null {
  const hasAt = w[j] === 'at' || w[j] === '@';
  const k = hasAt ? j + 1 : j;
  const a = w[k];
  if (a === undefined) return null;
  const used = hasAt ? 2 : 1;

  if (a === 'noon') return { time: '12:00', n: used, strong: hasAt };
  if (a === 'midnight') return { time: '00:00', n: used, strong: hasAt };

  const ampm = (h: number, mi: number, suffix: string): string | null => {
    if (h < 1 || h > 12 || mi > 59) return null;
    const pm = suffix.startsWith('p');
    return `${pad((h % 12) + (pm ? 12 : 0))}:${pad(mi)}`;
  };

  // 3pm, 3:30pm, 3p
  const m1 = a.match(/^(\d{1,2})(?::(\d{2}))?(am|pm|a|p)$/);
  if (m1) {
    const t = ampm(Number(m1[1]), Number(m1[2] ?? 0), m1[3]);
    return t ? { time: t, n: used, strong: true } : null;
  }
  // 3 pm, 3:30 pm
  const m2 = a.match(/^(\d{1,2})(?::(\d{2}))?$/);
  const next = w[k + 1];
  if (m2 && (next === 'am' || next === 'pm')) {
    const t = ampm(Number(m2[1]), Number(m2[2] ?? 0), next);
    return t ? { time: t, n: used + 1, strong: true } : null;
  }
  // 15:00
  const m3 = a.match(/^(\d{1,2}):(\d{2})$/);
  if (m3) {
    const h = Number(m3[1]);
    const mi = Number(m3[2]);
    return h <= 23 && mi <= 59 ? { time: `${pad(h)}:${pad(mi)}`, n: used, strong: true } : null;
  }
  return null;
}

interface DateMatch {
  value: SmartDate;
  n: number;
}

/**
 * The longest date phrase at `w[j]`: a date, a time, or both in either order. `bare` is for
 * text with no `^`, where every part must be unambiguous — unless an on/by/due introduced it.
 */
function matchDate(w: string[], j: number, ctx: SmartAddContext, bare: boolean): DateMatch | null {
  const today = parseYMD(ctx.today);
  const lead = CONNECTORS.has(w[j] ?? '') ? 1 : 0;
  const start = j + lead;
  const ok = (strong: boolean) => !bare || strong || lead === 1;

  const candidates: DateMatch[] = [];

  const d = datePart(w, start, today, ctx.now);
  if (d && ok(d.strong)) {
    const t = d.time === undefined ? timePart(w, start + d.n) : null;
    const withTime = t && ok(t.strong) ? t : null;
    candidates.push({
      value: { date: formatYMD(d.ymd), time: d.time ?? withTime?.time ?? null },
      n: lead + d.n + (withTime?.n ?? 0),
    });
  }

  const t = timePart(w, start);
  if (t && ok(t.strong)) {
    const after = datePart(w, start + t.n, today, ctx.now);
    if (after && after.time === undefined && ok(after.strong)) {
      candidates.push({
        value: { date: formatYMD(after.ymd), time: t.time },
        n: lead + t.n + after.n,
      });
    } else {
      // A time on its own is today's, or tomorrow's once it has gone by.
      const date = t.time > ctx.now ? today : addDays(today, 1);
      candidates.push({ value: { date: formatYMD(date), time: t.time }, n: lead + t.n });
    }
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (c.n > best.n ? c : best));
}

// ── Repeat phrases ──────────────────────────────────────────────────────────

interface RepeatMatch {
  rule: string;
  after: boolean;
  n: number;
}

const FREQ: Record<'day' | 'week' | 'month' | 'year', string> = {
  day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY',
};

function buildRule(freq: string, interval: number, byDay: number[] | null, count: number | null): string {
  const parts = [`FREQ=${freq}`];
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (byDay) {
    const days = [...new Set(byDay)].sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7));
    parts.push(`BYDAY=${days.map((d) => RRULE_DAYS[d]).join(',')}`);
  }
  if (count !== null) parts.push(`COUNT=${count}`);
  return parts.join(';');
}

/** "mon", "mon,wed", "mon and wed", "mon, wed and fri" — weekday names, any abbreviation. */
function weekdayList(w: string[], j: number): { days: number[]; n: number } | null {
  const days: number[] = [];
  let k = j;
  while (k < w.length) {
    const pieces = w[k].split(',').filter(Boolean);
    if (pieces.length === 0 || !pieces.every((p) => lookup(WEEKDAYS, p))) break;
    days.push(...pieces.map((p) => lookup(WEEKDAYS, p)!.day));
    k += 1;
    if (w[k] === 'and' && w[k + 1] !== undefined && w[k + 1].split(',').every((p) => lookup(WEEKDAYS, p))) k += 1;
  }
  return days.length ? { days, n: k - j } : null;
}

function matchRepeat(w: string[], j: number): RepeatMatch | null {
  const a = w[j];
  if (a === undefined) return null;
  let freq: string | null = null;
  let interval = 1;
  let byDay: number[] | null = null;
  let after = false;
  let n = 0;

  const simple: Record<string, [string, number]> = {
    daily: ['DAILY', 1], weekly: ['WEEKLY', 1], monthly: ['MONTHLY', 1], yearly: ['YEARLY', 1],
    annually: ['YEARLY', 1], biweekly: ['WEEKLY', 2], fortnightly: ['WEEKLY', 2],
  };

  const simpleRule = lookup(simple, a);
  if (simpleRule) {
    [freq, interval] = simpleRule;
    n = 1;
  } else if (a === 'weekdays') {
    freq = 'WEEKLY';
    byDay = [1, 2, 3, 4, 5];
    n = 1;
  } else if (a === 'every' || a === 'after') {
    after = a === 'after';
    let k = j + 1;
    if (!after && w[k] === 'other') {
      interval = 2;
      k += 1;
    } else {
      const count = parseCount(w[k]);
      if (count !== null && lookup(UNITS, w[k + 1])) {
        interval = count;
        k += 1;
      }
    }
    const unit = lookup(UNITS, w[k]);
    if (unit === 'day' || unit === 'week' || unit === 'month' || unit === 'year') {
      freq = FREQ[unit];
      n = k - j + 1;
    } else if (!after && (w[k] === 'weekday' || w[k] === 'weekdays') && interval === 1) {
      freq = 'WEEKLY';
      byDay = [1, 2, 3, 4, 5];
      n = k - j + 1;
    } else if (!after && (w[k] === 'weekend' || w[k] === 'weekends') && interval === 1) {
      freq = 'WEEKLY';
      byDay = [6, 0];
      n = k - j + 1;
    } else if (!after) {
      const list = weekdayList(w, k);
      if (list && (interval === 1 || interval === 2)) {
        freq = 'WEEKLY';
        byDay = list.days;
        n = k - j + list.n;
      }
    }
  }
  if (freq === null) return null;

  // "for 5 times"
  let count: number | null = null;
  const c = parseCount(w[j + n + 1]);
  if (w[j + n] === 'for' && c !== null && c > 0 && (w[j + n + 2] === 'times' || w[j + n + 2] === 'time')) {
    count = c;
    n += 3;
  }
  return { rule: buildRule(freq, interval, byDay, count), after, n };
}

// ── Estimates ───────────────────────────────────────────────────────────────

const ESTIMATE =
  /^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes))?$/;

function matchEstimate(w: string[], j: number): { minutes: number; n: number } | null {
  for (let len = Math.min(4, w.length - j); len >= 1; len--) {
    const text = w.slice(j, j + len).join(' ');
    const m = text.match(ESTIMATE);
    if (m && (m[1] !== undefined || m[2] !== undefined)) {
      const minutes = Math.round(Number(m[1] ?? 0) * 60) + Number(m[2] ?? 0);
      return { minutes, n: len };
    }
  }
  return null;
}

// ── The parser ──────────────────────────────────────────────────────────────

interface Word {
  raw: string;
  /** Lowercased, trailing punctuation removed — what the grammar reads. */
  norm: string;
  /** Inside "double quotes": title text, never a token. */
  quoted: boolean;
  used: boolean;
}

function normalise(raw: string): string {
  return raw.toLowerCase().replace(/[.,;:!?)]+$/, '').replace(/^\(+/, '');
}

function tokenize(text: string): Word[] {
  const words: Word[] = [];
  let quoted = false;
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const opens = !quoted && raw.startsWith('"');
    const inQuote = quoted || opens;
    const quotes = (raw.match(/"/g) ?? []).length;
    if (quotes % 2 === 1) quoted = !quoted;
    words.push({ raw, norm: normalise(raw), quoted: inQuote, used: false });
  }
  return words;
}

export function parseSmartAdd(text: string, ctx: SmartAddContext = smartAddContext()): SmartAddResult {
  const result: SmartAddResult = {
    title: '',
    due: null,
    start: null,
    priority: null,
    tags: [],
    recurrenceRule: null,
    repeatAfterCompletion: false,
    estimateMinutes: null,
    location: null,
    note: null,
  };

  // "// note" runs to the end of the line; a URL's "://" is not one.
  const noteAt = text.search(/(^|\s)\/\//);
  let body = text;
  if (noteAt !== -1) {
    const slash = text.indexOf('//', noteAt);
    const note = text.slice(slash + 2).trim();
    result.note = note || null;
    body = text.slice(0, slash);
  }

  const words = tokenize(body);

  // The phrase a prefixed token reads: the rest of its own word, then the words after it.
  const phrase = (i: number): { w: string[]; offset: number } => {
    const first = words[i].norm.slice(1);
    const rest = words.slice(i + 1).map((x) => (x.used || x.quoted ? '\u0000' : x.norm));
    return first ? { w: [first, ...rest], offset: 0 } : { w: rest, offset: 1 };
  };
  const consume = (i: number, n: number, offset: number) => {
    for (let k = i; k < i + n + offset && k < words.length; k++) words[k].used = true;
  };

  // Pass 1: the prefixed tokens.
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.used || word.quoted) continue;
    const sigil = word.norm[0];

    if (/^!([123])$/.test(word.norm)) {
      result.priority = Number(word.norm[1]) as 1 | 2 | 3;
      word.used = true;
    } else if (sigil === '#' && /^#[\p{L}_][\p{L}\p{N}_\-/.]*$/u.test(word.norm)) {
      const tag = word.norm.slice(1);
      if (!result.tags.includes(tag)) result.tags.push(tag);
      word.used = true;
    } else if (sigil === '@' && word.norm.length > 1 && word.raw.indexOf('@', 1) === -1) {
      result.location = word.raw.slice(1).replace(/[.,;:!?)]+$/, '');
      word.used = true;
    } else if (sigil === '^' || sigil === '~') {
      const { w, offset } = phrase(i);
      const match = matchDate(w, 0, ctx, false);
      if (match) {
        if (sigil === '^') result.due = match.value;
        else result.start = match.value;
        consume(i, match.n, offset);
        if (offset === 0) words[i].used = true;
      }
    } else if (sigil === '*') {
      const { w, offset } = phrase(i);
      const match = matchRepeat(w, 0);
      if (match) {
        result.recurrenceRule = match.rule;
        result.repeatAfterCompletion = match.after;
        consume(i, match.n, offset);
        words[i].used = true;
      }
    } else if (sigil === '=') {
      const { w, offset } = phrase(i);
      const match = matchEstimate(w, 0);
      if (match) {
        result.estimateMinutes = match.minutes;
        consume(i, match.n, offset);
        words[i].used = true;
      }
    }
  }

  // Pass 2: an un-prefixed date phrase, when there was no ^ — the first one that reads as a date.
  if (result.due === null) {
    for (let i = 0; i < words.length; i++) {
      if (words[i].used || words[i].quoted) continue;
      // A run of free words: a date phrase must not reach across a token or into quotes.
      let end = i;
      while (end < words.length && !words[end].used && !words[end].quoted) end++;
      const w = words.slice(i, end).map((x) => x.norm);
      const match = matchDate(w, 0, ctx, true);
      if (match) {
        result.due = match.value;
        consume(i, match.n, 0);
        break;
      }
    }
  }

  // A repeat with no due date starts on its first occurrence.
  if (result.recurrenceRule && result.due === null) {
    const today = parseYMD(ctx.today);
    const byDay = result.recurrenceRule.match(/BYDAY=([A-Z,]+)/)?.[1].split(',');
    const first = byDay
      ? byDay.map((d) => onOrAfter(today, RRULE_DAYS.indexOf(d))).sort(compareYMD)[0]
      : today;
    result.due = { date: formatYMD(first), time: null };
  }

  result.title = words
    .filter((w) => !w.used)
    .map((w) => w.raw)
    .join(' ')
    .trim();
  return result;
}

// ── To the wire ─────────────────────────────────────────────────────────────

/**
 * A parsed date as the server stores it: a date-only value is `<day>T00:00:00Z` (read back in
 * UTC, so it names the same day everywhere), a timed one is the instant in the user's zone.
 */
export function smartDateToWire(value: SmartDate): { iso: string; hasTime: boolean } {
  if (value.time === null) return { iso: `${value.date}T00:00:00Z`, hasTime: false };
  const [y, m, d] = value.date.split('-').map(Number);
  const [h, mi] = value.time.split(':').map(Number);
  const iso = new Date(y, m - 1, d, h, mi).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { iso, hasTime: true };
}

/**
 * The create request for a parsed line. Only what was typed is sent, so a plain title is still
 * just `{ title }`.
 */
export function smartAddToCreateRequest(result: SmartAddResult): CreateTaskRequest {
  const req: CreateTaskRequest = { title: result.title };
  if (result.note) req.notes = result.note;
  if (result.due) {
    const { iso, hasTime } = smartDateToWire(result.due);
    req.dueDate = iso;
    if (hasTime) req.dueHasTime = true;
  }
  if (result.start) {
    const { iso, hasTime } = smartDateToWire(result.start);
    req.startDate = iso;
    if (hasTime) req.startHasTime = true;
  }
  if (result.priority !== null) req.priority = result.priority;
  if (result.tags.length) req.tags = result.tags;
  if (result.recurrenceRule) {
    req.recurrenceRule = result.recurrenceRule;
    if (result.repeatAfterCompletion) req.repeatAfterCompletion = true;
  }
  if (result.estimateMinutes !== null) req.estimateMinutes = result.estimateMinutes;
  if (result.location) req.location = result.location;
  return req;
}

// ── Single fields, for the task editor ──────────────────────────────────────

function wholePhrase(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean).map(normalise);
}

/** A whole field read as a date phrase — "next fri 3pm" — or null when any of it isn't one. */
export function parseFriendlyDate(text: string, ctx: SmartAddContext = smartAddContext()): SmartDate | null {
  const w = wholePhrase(text);
  if (w.length === 0) return null;
  const match = matchDate(w, 0, ctx, false);
  return match && match.n === w.length ? match.value : null;
}

/** "every other week", "after 2 weeks", "weekly" — with or without the `*`. */
export function parseRepeat(text: string): { rule: string; after: boolean } | null {
  const w = wholePhrase(text.trim().replace(/^\*/, ''));
  if (w.length === 0) return null;
  const match = matchRepeat(w, 0);
  return match && match.n === w.length ? { rule: match.rule, after: match.after } : null;
}

/** "1h30m", "45 min", "2 hours" — with or without the `=`. */
export function parseEstimate(text: string): number | null {
  const w = wholePhrase(text.trim().replace(/^=/, ''));
  if (w.length === 0) return null;
  const match = matchEstimate(w, 0);
  return match && match.n === w.length ? match.minutes : null;
}

/** A task's stored due or start date as the date (and time) it names in this zone. */
export function smartDateFromWire(iso: string, hasTime: boolean): SmartDate {
  if (!hasTime) return { date: iso.slice(0, 10), time: null };
  const d = new Date(iso);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** "Fri, Oct 2" or "Fri, Oct 2, 3:00 PM". */
export function formatSmartDate(value: SmartDate): string {
  const [y, m, d] = value.date.split('-').map(Number);
  const [h, mi] = (value.time ?? '00:00').split(':').map(Number);
  const at = new Date(y, m - 1, d, h, mi);
  return at.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    ...(value.time !== null ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

/** "1h 30m", "45m", "2h". */
export function formatEstimate(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h}h` : '', m || !h ? `${m}m` : ''].filter(Boolean).join(' ');
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const UNIT_NAMES: Record<string, string> = {
  DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year',
};

/**
 * A rule in the words Smart Add reads it from — "every 2 weeks", "every Mon, Thu", "after 6
 * weeks" — so the editor's repeat field shows something the user could have typed.
 */
export function describeRepeat(rule: string, after: boolean): string {
  const parts = Object.fromEntries(
    rule.split(';').map((p) => p.split('=') as [string, string]).filter(([k, v]) => k && v),
  );
  const unit = lookup(UNIT_NAMES, parts.FREQ);
  if (!unit) return rule;
  const interval = Number(parts.INTERVAL ?? 1) || 1;
  let text: string;
  if (parts.BYDAY) {
    const days = parts.BYDAY.split(',').map((d: string) => RRULE_DAYS.indexOf(d.replace(/[^A-Z]/g, '')));
    const list = days.join(',') === '1,2,3,4,5' ? 'weekday'
      : days.join(',') === '6,0' ? 'weekend'
      : days.map((d: number) => DAY_NAMES[d]).join(', ');
    text = `every ${interval === 2 ? 'other ' : ''}${list}`;
  } else {
    const every = interval === 1 ? unit : interval === 2 && !after ? `other ${unit}` : `${interval} ${unit}s`;
    text = `${after ? 'after' : 'every'} ${after && interval === 1 ? `a ${unit}` : every}`;
  }
  if (parts.COUNT) text += ` for ${parts.COUNT} times`;
  return text;
}
