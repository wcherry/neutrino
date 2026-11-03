/**
 * Where Atlas logs, AtlasKit's `AtlasLog`: each entry goes to the console and to a buffer of this
 * tab's last 5,000 entries, which Show Logs reads. The buffer is memory only. Never log page
 * content: only paths (file names, which Drive has in plaintext anyway), ids, counts, sizes,
 * statuses and errors.
 */
export type LogLevel = 'info' | 'notice' | 'error';

export interface LogEntry {
  /** In order of logging, from the tab's start. */
  id: number;
  date: Date;
  level: LogLevel;
  category: string;
  message: string;
}

const LIMIT = 5000;
const entries: LogEntry[] = [];
let next = 0;
const listeners = new Set<() => void>();

function write(level: LogLevel, category: string, message: string): void {
  entries.push({ id: next++, date: new Date(), level, category, message });
  if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT);
  const line = `[atlas] ${category}: ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'notice') console.warn(line);
  else console.info(line);
  listeners.forEach((l) => l());
}

/** One category of entries. */
export class LogChannel {
  constructor(readonly category: string) {}
  info(message: string): void {
    write('info', this.category, message);
  }
  notice(message: string): void {
    write('notice', this.category, message);
  }
  error(message: string): void {
    write('error', this.category, message);
  }
}

export const AtlasLog = {
  app: new LogChannel('app'),
  sync: new LogChannel('sync'),
  drive: new LogChannel('drive'),
  editor: new LogChannel('editor'),
  images: new LogChannel('images'),
  /** This tab's entries, oldest first. */
  entries(): readonly LogEntry[] {
    return entries;
  },
  /** Called after each new entry. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

const two = (n: number, w = 2) => String(n).padStart(w, '0');

/** As copied or saved: `2026-11-02 11:35:29.676 error  images: …`. */
export function logLine(e: LogEntry): string {
  const d = e.date;
  const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${two(d.getMilliseconds(), 3)}`;
  return `${stamp} ${e.level.padEnd(6)} ${e.category}: ${e.message}`;
}
