import { describe, it, expect } from 'vitest';
// @ts-expect-error — a build script, deliberately plain ESM with no types.
import { shortCommit, formatVersionFile } from '../../scripts/write-version.mjs';

/** The regex `next.config.ts` reads the generated file back with. */
function readField(text: string, key: string): string {
  return new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1].trim() ?? '';
}

describe('write-version', () => {
  it('abbreviates a full SHA the way git does', () => {
    // The workflow passes `github.sha`, which is all 40 characters.
    expect(shortCommit('7adbe2412f3c4d5e6a7b8c9d0e1f2a3b4c5d6e7f')).toBe('7adbe24');
    expect(shortCommit('7adbe24')).toBe('7adbe24');
    expect(shortCommit('  7adbe24\n')).toBe('7adbe24');
    expect(shortCommit('')).toBe('');
  });

  it('writes what next.config.ts reads back', () => {
    const text = formatVersionFile({ version: '0.1.42', commit: '7adbe24' });

    expect(readField(text, 'version')).toBe('0.1.42');
    expect(readField(text, 'commit')).toBe('7adbe24');
  });

  it('keeps both keys present when a value is unknown', () => {
    // An unstamped image build writes blanks rather than omitting the line, so
    // the reader's regex still matches and yields ''.
    const text = formatVersionFile({ version: '', commit: '' });

    expect(text).toBe('version=\ncommit=\n');
    expect(readField(text, 'version')).toBe('');
    expect(readField(text, 'commit')).toBe('');
  });
});
