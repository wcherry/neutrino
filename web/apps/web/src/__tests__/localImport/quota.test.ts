/**
 * The pre-flight space check (`lib/localImport/quota.ts`).
 *
 * An import that runs out of quota halfway leaves the user with half a
 * library and a list of failures; saying so before the first byte is the
 * better answer. Both the storage quota and the daily upload cap are checked,
 * quota first, and either can be unlimited (`null`).
 */

import { describe, it, expect } from 'vitest';
import { checkQuota } from '@/lib/localImport/quota';

const MB = 1024 * 1024;
const GB = 1024 * MB;

function quota(extra: Partial<Parameters<typeof checkQuota>[0]> = {}): Parameters<typeof checkQuota>[0] {
  return {
    usedBytes: 0,
    quotaBytes: null,
    dailyUploadBytes: 0,
    dailyCapBytes: null,
    dailyResetAt: '2026-10-25T00:00:00Z',
    ...extra,
  };
}

describe('checkQuota', () => {
  it('passes anything when neither limit is set', () => {
    expect(checkQuota(quota({ usedBytes: 100 * GB }), 500 * GB)).toEqual({ ok: true });
  });

  it('passes an import that fills the quota exactly', () => {
    expect(checkQuota(quota({ usedBytes: 6 * GB, quotaBytes: 10 * GB }), 4 * GB)).toEqual({ ok: true });
  });

  it('passes an import that fills the daily cap exactly', () => {
    expect(
      checkQuota(quota({ dailyUploadBytes: 1 * GB, dailyCapBytes: 2 * GB }), 1 * GB),
    ).toEqual({ ok: true });
  });

  it('refuses an import that would go over the storage quota', () => {
    const result = checkQuota(quota({ usedBytes: 9 * GB, quotaBytes: 10 * GB }), 3 * GB);
    expect(result).toMatchObject({
      ok: false,
      reason: 'quota',
      neededBytes: 3 * GB,
      availableBytes: 1 * GB,
    });
  });

  it('reports no space available, never a negative amount, when already over quota', () => {
    const result = checkQuota(quota({ usedBytes: 12 * GB, quotaBytes: 10 * GB }), 1 * MB);
    expect(result).toMatchObject({ ok: false, reason: 'quota', availableBytes: 0 });
  });

  it('refuses an import that would go over the daily upload cap', () => {
    const result = checkQuota(
      quota({ dailyUploadBytes: 900 * MB, dailyCapBytes: 1 * GB }),
      200 * MB,
    );
    expect(result).toMatchObject({ ok: false, reason: 'daily', neededBytes: 200 * MB });
  });

  it('names the storage quota first when both limits would be broken', () => {
    const result = checkQuota(
      quota({ usedBytes: 10 * GB, quotaBytes: 10 * GB, dailyUploadBytes: 1 * GB, dailyCapBytes: 1 * GB }),
      1 * GB,
    );
    expect(result).toMatchObject({ ok: false, reason: 'quota' });
  });

  it('explains a quota refusal with a human-readable size', () => {
    const result = checkQuota(quota({ usedBytes: 9 * GB, quotaBytes: 10 * GB }), 3 * GB);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.message).toMatch(/GB|MB/);
  });

  it('explains a daily-cap refusal with a human-readable size', () => {
    const result = checkQuota(quota({ dailyUploadBytes: 900 * MB, dailyCapBytes: 1 * GB }), 200 * MB);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.message).toMatch(/GB|MB/);
  });
});
