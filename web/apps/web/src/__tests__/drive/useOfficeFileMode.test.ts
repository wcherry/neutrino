/**
 * Unit tests for getOfficeFileMode (issue #43 — in-place editing of MS Office
 * docs).
 *
 * Reads the localStorage-backed Settings toggle between "native round-trip"
 * (default) and "convert on open", key `neutrino:drive:officeFileMode` — same
 * localStorage-preference pattern used for calendar's WEEK_START_KEY
 * (apps/web/src/app/(apps)/calendar/page.tsx).
 *
 * This module does not exist yet (red phase / TDD) — expected to fail with a
 * "Cannot find module" error until useOfficeFileMode.ts lands at
 * web/apps/web/src/hooks/useOfficeFileMode.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getOfficeFileMode } from '../../hooks/useOfficeFileMode';

// The plan specifies this exact localStorage key (consistent with the
// existing preference-key convention, e.g. calendar's WEEK_START_KEY =
// 'neutrino:calendar:weekStart'). We only rely on the promised
// `getOfficeFileMode` export here — the key itself is not asserted to be a
// named export, just its documented literal value, to avoid this test
// failing for an unrelated reason if the key constant isn't exported.
const OFFICE_FILE_MODE_KEY = 'neutrino:drive:officeFileMode';

describe('getOfficeFileMode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to "native-roundtrip" when no value is stored', () => {
    expect(getOfficeFileMode()).toBe('native-roundtrip');
  });

  it('returns "native-roundtrip" when explicitly stored', () => {
    localStorage.setItem(OFFICE_FILE_MODE_KEY, 'native-roundtrip');
    expect(getOfficeFileMode()).toBe('native-roundtrip');
  });

  it('returns "convert-on-open" when stored', () => {
    localStorage.setItem(OFFICE_FILE_MODE_KEY, 'convert-on-open');
    expect(getOfficeFileMode()).toBe('convert-on-open');
  });

  it('falls back to the default when the stored value is invalid/unrecognized', () => {
    localStorage.setItem(OFFICE_FILE_MODE_KEY, 'garbage-value');
    expect(getOfficeFileMode()).toBe('native-roundtrip');
  });

  it('falls back to the default when the stored value is an empty string', () => {
    localStorage.setItem(OFFICE_FILE_MODE_KEY, '');
    expect(getOfficeFileMode()).toBe('native-roundtrip');
  });
});
