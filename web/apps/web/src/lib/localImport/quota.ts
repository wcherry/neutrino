/**
 * The pre-flight space check for a local import.
 *
 * An import that runs out of space halfway leaves half a library and a long
 * list of failures, so the summary says so before the first byte goes up.
 * The storage quota is checked first (it is the one that does not reset), then
 * the daily upload cap; either can be unlimited (`null`). Encryption adds a few
 * bytes per chunk that this does not count.
 */

import type { QuotaInfo } from '@neutrino/api-drive';
import { formatBytes } from '@/lib/takeout/log';

export type QuotaCheck =
  | { ok: true }
  | { ok: false; reason: 'quota' | 'daily'; neededBytes: number; availableBytes: number; message: string };

function resetTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function checkQuota(quota: QuotaInfo, bytes: number): QuotaCheck {
  if (quota.quotaBytes !== null && quota.usedBytes + bytes > quota.quotaBytes) {
    const availableBytes = Math.max(0, quota.quotaBytes - quota.usedBytes);
    return {
      ok: false,
      reason: 'quota',
      neededBytes: bytes,
      availableBytes,
      message: `This import is ${formatBytes(bytes)}, but only ${formatBytes(availableBytes)} of your storage is free. Leave some kinds out, or free up space first.`,
    };
  }
  if (quota.dailyCapBytes !== null && quota.dailyUploadBytes + bytes > quota.dailyCapBytes) {
    const availableBytes = Math.max(0, quota.dailyCapBytes - quota.dailyUploadBytes);
    const at = resetTime(quota.dailyResetAt);
    return {
      ok: false,
      reason: 'daily',
      neededBytes: bytes,
      availableBytes,
      message: `This import is ${formatBytes(bytes)}, but today's upload allowance has ${formatBytes(availableBytes)} left${
        at ? `; it resets at ${at}` : ''
      }. Leave some kinds out, or import the rest later.`,
    };
  }
  return { ok: true };
}
