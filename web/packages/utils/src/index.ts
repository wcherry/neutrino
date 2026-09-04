// ---------------------------------------------------------------------------
// File size formatting
// ---------------------------------------------------------------------------

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

export function formatDate(dateString: string, options?: Intl.DateTimeFormatOptions): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, options ?? {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateString);
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Midnight local time on the day the given instant falls in. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole calendar months between two instants, e.g. Jan 31 → Feb 1 is 0. */
function calendarMonthsBetween(from: Date, to: Date): number {
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return to.getDate() < from.getDate() ? months - 1 : months;
}

/**
 * A date said the way someone would say it: "Just now", "An hour ago",
 * "Yesterday", "Monday", "A week ago", "A month ago".
 *
 * Written for the file cards, where the date answers "is this the one I was
 * working on?" rather than "what date was that?" — so it is deliberately
 * coarser than `formatDate`, which is what the sortable Modified column still
 * shows. `formatRelativeTime` is the older, terser form of the same idea
 * ("30m ago") and is kept for the surfaces already using it.
 *
 * Anything under an hour counts in elapsed time; past that the buckets are
 * *calendar* comparisons, so 11pm last night is "Yesterday" at 1am rather than
 * "2 hours ago". Beyond a year of weekday names being useless, it falls back to
 * weeks, months and then years.
 *
 * `now` is injectable for tests; callers pass the one argument.
 */
export function formatFriendlyDate(
  value: string | number | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return '';

  const diff = now.getTime() - ms;
  // Clocks disagree — a server timestamp a few seconds ahead of the browser is
  // this moment, not a date to count down to. Only a real future date, which
  // no listing should carry, gets shown as one.
  if (diff < -MINUTE_MS) return formatDate(date.toISOString());

  if (diff < 45 * SECOND_MS) return 'Just now';
  if (diff < 90 * SECOND_MS) return 'A minute ago';
  if (diff < HOUR_MS) return `${Math.round(diff / MINUTE_MS)} minutes ago`;

  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days === 0) {
    const hours = Math.floor(diff / HOUR_MS);
    return hours <= 1 ? 'An hour ago' : `${hours} hours ago`;
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  if (days < 14) return 'A week ago';

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} weeks ago`;

  const months = calendarMonthsBetween(date, now);
  if (months <= 1) return 'A month ago';
  if (months < 12) return `${months} months ago`;

  const years = Math.floor(months / 12);
  return years === 1 ? 'A year ago' : `${years} years ago`;
}

// ---------------------------------------------------------------------------
// String utilities
// ---------------------------------------------------------------------------

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  if (parts.length < 2) return '';
  return parts[parts.length - 1].toLowerCase();
}

export function getFilenameWithoutExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return filename;
  return filename.slice(0, lastDot);
}

// ---------------------------------------------------------------------------
// MIME type helpers
// ---------------------------------------------------------------------------

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export function isVideoMimeType(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

export function isAudioMimeType(mimeType: string): boolean {
  return mimeType.startsWith('audio/');
}

export function isTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith('text/') || mimeType === 'application/json';
}

export function isPdfMimeType(mimeType: string): boolean {
  return mimeType === 'application/pdf';
}

export function isZipMimeType(mimeType: string): boolean {
  return (
    mimeType === 'application/zip' ||
    mimeType === 'application/x-zip-compressed' ||
    mimeType === 'application/x-zip'
  );
}

// ---------------------------------------------------------------------------
// Class name merging (lightweight cn helper)
// ---------------------------------------------------------------------------

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Thumbnail generation
// ---------------------------------------------------------------------------

/**
 * Generate a JPEG thumbnail for an image file using the browser Canvas API.
 * Returns the raw base64 string (no data-URL prefix), or null on failure.
 *
 * It lives here rather than in `@neutrino/api-photos` (which re-exports it, and
 * where it used to be defined) because every encrypted upload needs one: the
 * server holds ciphertext and cannot make a preview of it, so a Drive file
 * without a client-made thumbnail shows as a blank tile. `@neutrino/api-drive`
 * is what generates them now, and it cannot import api-photos — api-photos
 * imports it.
 */
export function generateThumbnail(file: File, maxSize = 512): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.warn('[thumbnail] failed: could not get 2d context');
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      resolve(dataUrl.split(',')[1] ?? null);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      console.warn('[thumbnail] image load failed:', e);
      resolve(null);
    };
    img.src = url;
  });
}
