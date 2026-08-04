/**
 * Tests for the import's error description (`lib/takeout/log.ts`).
 *
 * `describeError` is not only a log line: it is the reason shown against a
 * failed item on the result screen, so the difference between "Session
 * expired" and "HTTP 413: body too large" is the difference between the user
 * knowing what to do next and not.
 */

import { describe, it, expect } from 'vitest';
import { describeError, formatBytes } from '@/lib/takeout/log';

describe('describeError', () => {
  it('spells out the status and code an API rejection carries', () => {
    const err = Object.assign(new Error('Body too large'), {
      name: 'ApiClientError',
      statusCode: 413,
      code: 'PAYLOAD_TOO_LARGE',
    });
    expect(describeError(err)).toBe('HTTP 413 PAYLOAD_TOO_LARGE: Body too large');
  });

  it('copes with an API rejection that carries no code or message', () => {
    expect(describeError({ statusCode: 500 })).toBe('HTTP 500');
  });

  it('uses the message of an ordinary error', () => {
    expect(describeError(new Error('not a docx'))).toBe('not a docx');
  });

  it('never throws on something that is not an error at all', () => {
    expect(describeError('a string')).toBe('a string');
    expect(describeError(null)).toBe('Unknown error');
    expect(describeError(undefined)).toBe('Unknown error');
    expect(describeError({})).toBe('Unknown error');
  });
});

describe('formatBytes', () => {
  it('scales to the unit that reads best', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
