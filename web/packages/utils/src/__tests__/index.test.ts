import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatFileSize,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  formatFriendlyDate,
  truncate,
  getFileExtension,
  getFilenameWithoutExtension,
  isImageMimeType,
  isVideoMimeType,
  isAudioMimeType,
  isTextMimeType,
  isPdfMimeType,
  isZipMimeType,
  cn,
} from '../index';

// ---------------------------------------------------------------------------
// formatFileSize
// ---------------------------------------------------------------------------

describe('formatFileSize', () => {
  it('formats bytes under 1 KB', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1)).toBe('1 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(1024 * 1024 - 1)).toContain('KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });

  it('formats gigabytes', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB');
    expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.50 GB');
  });
});

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

describe('truncate', () => {
  it('returns the string unchanged when shorter than max', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('returns the string unchanged when equal to max', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates with ellipsis when longer than max', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  it('handles very short max lengths', () => {
    expect(truncate('abcdefgh', 3)).toBe('...');
  });
});

// ---------------------------------------------------------------------------
// getFileExtension
// ---------------------------------------------------------------------------

describe('getFileExtension', () => {
  it('returns the extension in lowercase', () => {
    expect(getFileExtension('image.PNG')).toBe('png');
    expect(getFileExtension('document.TXT')).toBe('txt');
  });

  it('returns the last extension for multiple dots', () => {
    expect(getFileExtension('archive.tar.gz')).toBe('gz');
  });

  it('returns empty string when there is no extension', () => {
    expect(getFileExtension('noextension')).toBe('');
  });

  it('handles simple common extensions', () => {
    expect(getFileExtension('file.pdf')).toBe('pdf');
    expect(getFileExtension('photo.jpg')).toBe('jpg');
  });
});

// ---------------------------------------------------------------------------
// getFilenameWithoutExtension
// ---------------------------------------------------------------------------

describe('getFilenameWithoutExtension', () => {
  it('removes the extension from a simple filename', () => {
    expect(getFilenameWithoutExtension('file.txt')).toBe('file');
  });

  it('removes only the last extension for multiple dots', () => {
    expect(getFilenameWithoutExtension('archive.tar.gz')).toBe('archive.tar');
  });

  it('returns the full filename when there is no extension', () => {
    expect(getFilenameWithoutExtension('noextension')).toBe('noextension');
  });
});

// ---------------------------------------------------------------------------
// MIME type helpers
// ---------------------------------------------------------------------------

describe('isImageMimeType', () => {
  it('returns true for image types', () => {
    expect(isImageMimeType('image/jpeg')).toBe(true);
    expect(isImageMimeType('image/png')).toBe(true);
    expect(isImageMimeType('image/gif')).toBe(true);
  });

  it('returns false for non-image types', () => {
    expect(isImageMimeType('video/mp4')).toBe(false);
    expect(isImageMimeType('application/pdf')).toBe(false);
  });
});

describe('isVideoMimeType', () => {
  it('returns true for video types', () => {
    expect(isVideoMimeType('video/mp4')).toBe(true);
    expect(isVideoMimeType('video/webm')).toBe(true);
  });

  it('returns false for non-video types', () => {
    expect(isVideoMimeType('image/jpeg')).toBe(false);
    expect(isVideoMimeType('audio/mpeg')).toBe(false);
  });
});

describe('isAudioMimeType', () => {
  it('returns true for audio types', () => {
    expect(isAudioMimeType('audio/mpeg')).toBe(true);
    expect(isAudioMimeType('audio/wav')).toBe(true);
  });

  it('returns false for non-audio types', () => {
    expect(isAudioMimeType('video/mp4')).toBe(false);
  });
});

describe('isTextMimeType', () => {
  it('returns true for text/* types', () => {
    expect(isTextMimeType('text/plain')).toBe(true);
    expect(isTextMimeType('text/html')).toBe(true);
    expect(isTextMimeType('text/csv')).toBe(true);
  });

  it('returns true for application/json', () => {
    expect(isTextMimeType('application/json')).toBe(true);
  });

  it('returns false for non-text types', () => {
    expect(isTextMimeType('application/pdf')).toBe(false);
    expect(isTextMimeType('image/png')).toBe(false);
  });
});

describe('isPdfMimeType', () => {
  it('returns true for application/pdf', () => {
    expect(isPdfMimeType('application/pdf')).toBe(true);
  });

  it('returns false for other types', () => {
    expect(isPdfMimeType('text/plain')).toBe(false);
    expect(isPdfMimeType('image/jpeg')).toBe(false);
  });
});

describe('isZipMimeType', () => {
  it('returns true for all zip MIME variants', () => {
    expect(isZipMimeType('application/zip')).toBe(true);
    expect(isZipMimeType('application/x-zip-compressed')).toBe(true);
    expect(isZipMimeType('application/x-zip')).toBe(true);
  });

  it('returns false for non-zip types', () => {
    expect(isZipMimeType('application/pdf')).toBe(false);
    expect(isZipMimeType('image/jpeg')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cn
// ---------------------------------------------------------------------------

describe('cn', () => {
  it('joins multiple class names with a space', () => {
    expect(cn('foo', 'bar', 'baz')).toBe('foo bar baz');
  });

  it('filters out falsy values', () => {
    expect(cn('foo', undefined, null, false, 'bar')).toBe('foo bar');
  });

  it('returns an empty string when all values are falsy', () => {
    expect(cn(undefined, null, false)).toBe('');
  });

  it('returns a single class name', () => {
    expect(cn('only')).toBe('only');
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for less than 60 seconds ago', () => {
    const date = new Date('2024-06-15T11:59:30Z').toISOString();
    expect(formatRelativeTime(date)).toBe('just now');
  });

  it('returns minutes ago for less than 60 minutes', () => {
    const date = new Date('2024-06-15T11:30:00Z').toISOString();
    expect(formatRelativeTime(date)).toBe('30m ago');
  });

  it('returns hours ago for less than 24 hours', () => {
    const date = new Date('2024-06-15T09:00:00Z').toISOString();
    expect(formatRelativeTime(date)).toBe('3h ago');
  });

  it('returns days ago for less than 7 days', () => {
    const date = new Date('2024-06-12T12:00:00Z').toISOString();
    expect(formatRelativeTime(date)).toBe('3d ago');
  });

  it('returns a formatted date for 7 or more days ago', () => {
    const date = new Date('2024-06-01T12:00:00Z').toISOString();
    const result = formatRelativeTime(date);
    // Falls through to formatDate which uses toLocaleDateString
    expect(result).not.toContain('ago');
    expect(result).not.toBe('just now');
  });
});

// ---------------------------------------------------------------------------
// formatDate / formatDateTime
// ---------------------------------------------------------------------------

describe('formatDate', () => {
  it('returns a human-readable date string', () => {
    const result = formatDate('2024-01-15T00:00:00Z');
    // Exact output depends on locale, but should contain the year
    expect(result).toContain('2024');
  });

  it('accepts custom Intl options', () => {
    const result = formatDate('2024-01-15T00:00:00Z', { year: 'numeric' });
    expect(result).toContain('2024');
  });
});

describe('formatDateTime', () => {
  it('returns a human-readable date-time string containing the year', () => {
    const result = formatDateTime('2024-01-15T10:30:00Z');
    expect(result).toContain('2024');
  });
});

// ---------------------------------------------------------------------------
// formatFriendlyDate
// ---------------------------------------------------------------------------

/**
 * Dates are built in local time, not from UTC strings: the day-based buckets
 * ("Yesterday", the weekday names) are calendar comparisons, so a UTC literal
 * would land on a different day depending on the machine running the suite.
 */
describe('formatFriendlyDate', () => {
  // A Saturday at midday, so "a week ago" and the weekday names have room on
  // both sides of it.
  const now = new Date(2024, 5, 15, 12, 0, 0);
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "Just now" for the last few seconds', () => {
    expect(formatFriendlyDate(now.toISOString())).toBe('Just now');
    expect(formatFriendlyDate(ago(30 * SECOND).toISOString())).toBe('Just now');
  });

  it('returns "A minute ago" for around a minute', () => {
    expect(formatFriendlyDate(ago(60 * SECOND).toISOString())).toBe('A minute ago');
    expect(formatFriendlyDate(ago(85 * SECOND).toISOString())).toBe('A minute ago');
  });

  it('returns minutes for the rest of the hour', () => {
    expect(formatFriendlyDate(ago(5 * MINUTE).toISOString())).toBe('5 minutes ago');
    expect(formatFriendlyDate(ago(59 * MINUTE).toISOString())).toBe('59 minutes ago');
  });

  it('returns "An hour ago" for one hour', () => {
    expect(formatFriendlyDate(ago(HOUR).toISOString())).toBe('An hour ago');
    expect(formatFriendlyDate(ago(80 * MINUTE).toISOString())).toBe('An hour ago');
  });

  it('returns hours for the rest of the day', () => {
    expect(formatFriendlyDate(ago(3 * HOUR).toISOString())).toBe('3 hours ago');
    expect(formatFriendlyDate(ago(11 * HOUR).toISOString())).toBe('11 hours ago');
  });

  it('returns "Yesterday" for the previous calendar day', () => {
    expect(formatFriendlyDate(new Date(2024, 5, 14, 23, 30).toISOString())).toBe('Yesterday');
    expect(formatFriendlyDate(new Date(2024, 5, 14, 0, 5).toISOString())).toBe('Yesterday');
  });

  it('counts calendar days, so late last night is "Yesterday" rather than hours', () => {
    vi.setSystemTime(new Date(2024, 5, 15, 1, 0));
    expect(formatFriendlyDate(new Date(2024, 5, 14, 23, 0).toISOString())).toBe('Yesterday');
  });

  it('names the weekday for the rest of the week', () => {
    expect(formatFriendlyDate(new Date(2024, 5, 13, 9, 0).toISOString())).toBe('Thursday');
    expect(formatFriendlyDate(new Date(2024, 5, 10, 9, 0).toISOString())).toBe('Monday');
    expect(formatFriendlyDate(new Date(2024, 5, 9, 9, 0).toISOString())).toBe('Sunday');
  });

  it('returns "A week ago" from seven days back', () => {
    expect(formatFriendlyDate(new Date(2024, 5, 8, 9, 0).toISOString())).toBe('A week ago');
    expect(formatFriendlyDate(new Date(2024, 5, 2, 9, 0).toISOString())).toBe('A week ago');
  });

  it('returns whole weeks up to a month', () => {
    expect(formatFriendlyDate(new Date(2024, 5, 1, 9, 0).toISOString())).toBe('2 weeks ago');
    expect(formatFriendlyDate(new Date(2024, 4, 22, 9, 0).toISOString())).toBe('3 weeks ago');
  });

  it('returns "A month ago" for the previous month', () => {
    expect(formatFriendlyDate(new Date(2024, 4, 10, 9, 0).toISOString())).toBe('A month ago');
  });

  it('returns whole months up to a year', () => {
    expect(formatFriendlyDate(new Date(2024, 2, 15, 9, 0).toISOString())).toBe('3 months ago');
    expect(formatFriendlyDate(new Date(2023, 7, 15, 9, 0).toISOString())).toBe('10 months ago');
  });

  it('returns "A year ago" and then whole years', () => {
    expect(formatFriendlyDate(new Date(2023, 5, 15, 9, 0).toISOString())).toBe('A year ago');
    expect(formatFriendlyDate(new Date(2021, 5, 15, 9, 0).toISOString())).toBe('3 years ago');
  });

  it('treats a slightly-future timestamp as now, since clocks disagree', () => {
    expect(formatFriendlyDate(new Date(now.getTime() + 20 * SECOND).toISOString())).toBe('Just now');
  });

  it('falls back to an absolute date for a timestamp well in the future', () => {
    const result = formatFriendlyDate(new Date(2030, 0, 1, 9, 0).toISOString());
    expect(result).toContain('2030');
    expect(result).not.toContain('ago');
  });

  it('returns an empty string for a missing or unparseable date', () => {
    expect(formatFriendlyDate(undefined)).toBe('');
    expect(formatFriendlyDate('')).toBe('');
    expect(formatFriendlyDate('not a date')).toBe('');
  });
});
