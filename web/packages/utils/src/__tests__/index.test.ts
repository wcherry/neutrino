import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatFileSize,
  formatDate,
  formatDateTime,
  formatRelativeTime,
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
