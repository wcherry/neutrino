/**
 * Tests for `lib/takeout/importMetadata.ts` — the dates an imported file gets
 * (issue #110).
 *
 * Two things are under test and neither is the happy path on its own. The
 * first is that a date nobody can vouch for is *dropped* rather than written:
 * a zip with no timestamp reads back as 1980, `new Date(0)` is 1970, and a
 * microsecond value read as seconds lands tens of thousands of years out —
 * each of which would be stamped onto the file as confidently as a real date
 * and none of which is recoverable afterwards. The second is that a failure to
 * record the dates does not fail the file: the content is already uploaded by
 * then, and reporting it as a failure would invite the user to import the
 * whole archive a second time.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const storageApi = { setImportMetadata: vi.fn() };
vi.mock('@/lib/api', () => ({
  get storageApi() {
    return storageApi;
  },
}));

import {
  applyImportMetadata,
  captureDateFromIso,
  datesFor,
  isoFromDate,
  isoFromEpoch,
  isoFromText,
} from '@/lib/takeout/importMetadata';
import type { TakeoutEntry } from '@/lib/takeout/archive';

function entry(lastModified: Date | null): TakeoutEntry {
  return {
    path: 'Q3 plan.docx',
    fullPath: 'Takeout/Drive/Q3 plan.docx',
    ext: 'docx',
    size: 0,
    lastModified,
    text: async () => '',
    blob: async () => new Blob([]),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storageApi.setImportMetadata.mockResolvedValue({});
});

describe('reading a date out of what the export wrote', () => {
  it('takes a zip entry’s date', () => {
    expect(isoFromDate(new Date('2014-03-01T12:00:00Z'))).toBe('2014-03-01T12:00:00.000Z');
    expect(isoFromDate(null)).toBeUndefined();
    expect(isoFromDate(new Date('nonsense'))).toBeUndefined();
  });

  it('reads an epoch timestamp in the unit the product wrote it in', () => {
    // Keep: microseconds. Photos: seconds, as a string.
    expect(isoFromEpoch(1393675200000000, 'microseconds')).toBe('2014-03-01T12:00:00.000Z');
    expect(isoFromEpoch('1393675200', 'seconds')).toBe('2014-03-01T12:00:00.000Z');
  });

  /**
   * The unit is a parameter for exactly this reason: Keep's microseconds read
   * as seconds is the year 46,138, which would sort every imported note past
   * everything else in the drive forever.
   */
  it('drops a timestamp read in the wrong unit rather than dating a file to the year 46,138', () => {
    expect(isoFromEpoch(1393675200000000, 'seconds')).toBeUndefined();
  });

  it('drops the values that mean “no date was recorded”', () => {
    expect(isoFromEpoch(0, 'seconds')).toBeUndefined();
    expect(isoFromEpoch(-1, 'seconds')).toBeUndefined();
    expect(isoFromEpoch(undefined, 'microseconds')).toBeUndefined();
    // 1970 from a zero epoch and 1980 from an unset DOS timestamp are both
    // "unset" rather than dates anyone chose.
    expect(isoFromDate(new Date(0))).toBeUndefined();
    expect(isoFromDate(new Date('1980-01-01T00:00:00Z'))).toBeUndefined();
  });

  it('reads the ISO strings a Drive sidecar carries, with or without a zone', () => {
    expect(isoFromText('2014-03-01T12:00:00.000Z')).toBe('2014-03-01T12:00:00.000Z');
    expect(isoFromText('2014-03-01')).toBe('2014-03-01T00:00:00.000Z');
    expect(isoFromText('last Tuesday')).toBeUndefined();
    expect(isoFromText('')).toBeUndefined();
    expect(isoFromText(undefined)).toBeUndefined();
  });
});

describe('choosing which dates to write', () => {
  it('prefers what the export recorded over the zip entry', () => {
    const dates = datesFor(entry(new Date('2020-01-01T00:00:00Z')), {
      createdAt: '2014-03-01T12:00:00.000Z',
      updatedAt: '2016-07-04T09:30:00.000Z',
    });

    expect(dates).toEqual({
      createdAt: '2014-03-01T12:00:00.000Z',
      updatedAt: '2016-07-04T09:30:00.000Z',
    });
  });

  /**
   * The zip's single mtime fills *both* dates. Filling only the modified date
   * would leave the created date at the import's clock, which is half of issue
   * #110 still in place — and a file's mtime is a far better guess at when it
   * was written than this afternoon is.
   */
  it('falls back to the zip entry for both dates when there is no metadata', () => {
    const dates = datesFor(entry(new Date('2014-03-01T12:00:00Z')), {});

    expect(dates).toEqual({
      createdAt: '2014-03-01T12:00:00.000Z',
      updatedAt: '2014-03-01T12:00:00.000Z',
    });
  });

  it('leaves both dates alone when nothing in the export knows them', () => {
    expect(datesFor(entry(null), {})).toEqual({});
  });

  /**
   * A sidecar `created_date` beside a zip entry dated when the export was
   * built produces this pair, and it renders as a file modified before it
   * existed.
   */
  it('will not date a file as modified before it was created', () => {
    const dates = datesFor(entry(new Date('2010-01-01T00:00:00Z')), {
      createdAt: '2014-03-01T12:00:00.000Z',
    });

    expect(dates).toEqual({
      createdAt: '2014-03-01T12:00:00.000Z',
      updatedAt: '2014-03-01T12:00:00.000Z',
    });
  });
});

describe('writing them', () => {
  it('sends the dates and where they came from', async () => {
    await applyImportMetadata({
      fileId: 'file-1',
      scope: 'docs',
      source: 'Takeout/Drive/Q3 plan.docx',
      dates: { createdAt: '2014-03-01T12:00:00.000Z', updatedAt: '2016-07-04T09:30:00.000Z' },
    });

    expect(storageApi.setImportMetadata).toHaveBeenCalledWith('file-1', {
      importSource: 'Takeout/Drive/Q3 plan.docx',
      createdAt: '2014-03-01T12:00:00.000Z',
      updatedAt: '2016-07-04T09:30:00.000Z',
    });
  });

  /**
   * The content is already uploaded by the time this runs. A rejection here
   * means a file with the wrong dates, not a file that failed to import, and
   * throwing would report the whole item as failed.
   */
  it('does not fail the file when the dates cannot be recorded', async () => {
    storageApi.setImportMetadata.mockRejectedValue(new Error('nope'));

    await expect(
      applyImportMetadata({
        fileId: 'file-1',
        scope: 'docs',
        source: 'Takeout/Drive/Q3 plan.docx',
        dates: { createdAt: '2014-03-01T12:00:00.000Z' },
      }),
    ).resolves.toBeUndefined();
  });
});

/**
 * `POST /api/v1/photos` parses `%Y-%m-%dT%H:%M:%S` and silently drops anything
 * else, so the `Z` and the milliseconds `toISOString` adds have to come off.
 */
describe('captureDateFromIso', () => {
  it('trims an ISO string to the one shape the photos endpoint parses', () => {
    expect(captureDateFromIso('2014-03-01T12:00:00.000Z')).toBe('2014-03-01T12:00:00');
    expect(captureDateFromIso(undefined)).toBeUndefined();
  });
});
