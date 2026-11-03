/**
 * Dates in Unicode patterns (UTS #35), as the Mac's `DateFormatter` writes them with the
 * `en_US_POSIX` locale: what daily-note names and template variables (`{{date:EEEE d MMMM}}`)
 * are written in, so a vault's daily notes have the same names on every device. Local time.
 *
 * The fields daily notes and templates use: era-less years (`y`, `yy`, `yyyy`), months (`M`,
 * `MM`, `MMM`, `MMMM`, and stand-alone `L…`), days (`d`, `dd`), weekdays (`E`…`EEEEE`, `c`/`e`
 * from four letters), hours (`H`, `HH`, `h`, `hh`, `k`, `K`), minutes, seconds, fractions (`S…`)
 * and `a`. Text in quotes is literal (`''` is a quote); other characters are written as they are.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Token = { field: string; count: number } | { literal: string };

const FIELDS = new Set(['y', 'M', 'L', 'd', 'E', 'e', 'c', 'H', 'h', 'k', 'K', 'm', 's', 'S', 'a']);

function tokens(pattern: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "'") {
      if (pattern[i + 1] === "'") {
        out.push({ literal: "'" });
        i += 2;
        continue;
      }
      let j = i + 1;
      let text = '';
      while (j < pattern.length) {
        if (pattern[j] === "'") {
          if (pattern[j + 1] === "'") {
            text += "'";
            j += 2;
            continue;
          }
          break;
        }
        text += pattern[j++];
      }
      out.push({ literal: text });
      i = j + 1;
      continue;
    }
    if (FIELDS.has(ch)) {
      let n = 1;
      while (pattern[i + n] === ch) n++;
      out.push({ field: ch, count: n });
      i += n;
      continue;
    }
    out.push({ literal: ch });
    i++;
  }
  return out;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** `date` written in `pattern`. */
export function formatDate(date: Date, pattern: string): string {
  return tokens(pattern)
    .map((t) => {
      if ('literal' in t) return t.literal;
      const n = t.count;
      switch (t.field) {
        case 'y': return n === 2 ? pad(date.getFullYear() % 100, 2) : pad(date.getFullYear(), n);
        case 'M': case 'L': {
          const m = date.getMonth();
          return n >= 5 ? MONTHS[m][0] : n === 4 ? MONTHS[m] : n === 3 ? MONTHS[m].slice(0, 3) : pad(m + 1, n);
        }
        case 'd': return pad(date.getDate(), n);
        case 'E': case 'e': case 'c': {
          const day = DAYS[date.getDay()];
          if ((t.field === 'e' || t.field === 'c') && n <= 2) return pad(date.getDay() + 1, n);
          return n >= 5 ? day[0] : n === 4 ? day : day.slice(0, 3);
        }
        case 'H': return pad(date.getHours(), n);
        case 'k': return pad(date.getHours() || 24, n);
        case 'h': return pad(date.getHours() % 12 || 12, n);
        case 'K': return pad(date.getHours() % 12, n);
        case 'm': return pad(date.getMinutes(), n);
        case 's': return pad(date.getSeconds(), n);
        case 'S': return pad(date.getMilliseconds(), 3).padEnd(n, '0').slice(0, n);
        case 'a': return date.getHours() < 12 ? 'AM' : 'PM';
        default: return '';
      }
    })
    .join('');
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The date `text` is in `pattern`, at local midnight unless the pattern has a time; null when it
 * doesn't read as one. Lenient as DateFormatter isn't, so callers check by formatting back.
 */
export function parseDate(text: string, pattern: string): Date | null {
  const parts: { field: string; count: number }[] = [];
  let source = '^';
  for (const t of tokens(pattern)) {
    if ('literal' in t) {
      source += escape(t.literal);
      continue;
    }
    parts.push(t);
    const n = t.count;
    switch (t.field) {
      case 'M': case 'L':
        source += n === 4 ? `(${MONTHS.join('|')})` : n === 3 ? `(${MONTHS.map((m) => m.slice(0, 3)).join('|')})` : n >= 5 ? '([A-Z])' : n === 1 ? '(\\d{1,2})' : `(\\d{${n}})`;
        break;
      case 'E': case 'e': case 'c':
        source += n === 4 ? `(${DAYS.join('|')})` : n >= 5 ? '([A-Z])' : (t.field !== 'E' && n <= 2) ? '(\\d{1,2})' : `(${DAYS.map((d) => d.slice(0, 3)).join('|')})`;
        break;
      case 'a':
        source += '(AM|PM)';
        break;
      case 'y':
        source += n === 1 ? '(\\d{1,4})' : n === 2 ? '(\\d{2})' : `(\\d{${n}})`;
        break;
      default:
        source += n === 1 ? '(\\d{1,2})' : `(\\d{${n}})`;
    }
  }
  const m = new RegExp(source + '$').exec(text);
  if (!m) return null;
  let year = 2000;
  let month = 0;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let pm: boolean | null = null;
  let twelve = false;
  parts.forEach((p, k) => {
    const v = m[k + 1];
    switch (p.field) {
      case 'y': year = p.count === 2 ? 2000 + Number(v) : Number(v); break;
      case 'M': case 'L':
        if (p.count === 4) month = MONTHS.indexOf(v);
        else if (p.count === 3) month = MONTHS.findIndex((x) => x.startsWith(v));
        else if (p.count < 5) month = Number(v) - 1;
        break;
      case 'd': day = Number(v); break;
      case 'H': case 'k': hour = Number(v) % 24; break;
      case 'h': case 'K': hour = Number(v) % 12; twelve = true; break;
      case 'm': minute = Number(v); break;
      case 's': second = Number(v); break;
      case 'a': pm = v === 'PM'; break;
    }
  });
  if (twelve && pm) hour += 12;
  const date = new Date(year, month, day, hour, minute, second);
  return date.getMonth() === month && date.getDate() === day ? date : null;
}
