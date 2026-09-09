// @vitest-environment jsdom
/**
 * `storageApi.getThumbnailUrl` — turning the API's relative `coverThumbnailUrl`
 * into something an `<img src>` can load.
 *
 * Thumbnails stopped riding along inside the listing JSON in issue #175: a page
 * of files carried a base64 image per row, several megabytes for a grid of
 * photos, and a browser could cache none of it because none of it had a URL.
 * The two properties that replaced it are what this pins down — the token has
 * to be *appended* to a path that already has a query string (the cache-busting
 * `v`), and a file with no thumbnail has to come back null rather than as a URL
 * that 404s behind an `<img>`.
 *
 * Mocking convention follows `driveReadContent.test.ts`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@neutrino/api-core', () => ({
  request: vi.fn(),
  buildQuery: () => '',
  ApiClientError: class ApiClientError extends Error {},
  BASE_URL: 'https://drive.test',
}));

import { storageApi } from '../client';

describe('storageApi.getThumbnailUrl', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('adds the origin and the token to the path the API returned', () => {
    localStorage.setItem('access_token', 'tok-1');

    expect(storageApi.getThumbnailUrl('/api/v1/drive/files/file-1/thumbnail?v=42')).toBe(
      'https://drive.test/api/v1/drive/files/file-1/thumbnail?v=42&token=tok-1',
    );
  });

  /**
   * `v` is the whole cache story: the response is `immutable` for a year, so a
   * replaced thumbnail is only ever fetched again because its URL changed.
   * Appending the token with `?` instead of `&` would drop it.
   */
  it('keeps the cache-busting parameter the API put in the path', () => {
    localStorage.setItem('access_token', 'tok-1');

    const url = storageApi.getThumbnailUrl('/api/v1/drive/files/f/thumbnail?v=99')!;

    expect(new URL(url).searchParams.get('v')).toBe('99');
    expect(new URL(url).searchParams.get('token')).toBe('tok-1');
  });

  it('starts the query string when the path carries none', () => {
    localStorage.setItem('access_token', 'tok-1');

    expect(storageApi.getThumbnailUrl('/api/v1/drive/files/f/thumbnail')).toBe(
      'https://drive.test/api/v1/drive/files/f/thumbnail?token=tok-1',
    );
  });

  /** A file with no thumbnail draws its type icon, not a broken image. */
  it('answers null for a file with no thumbnail', () => {
    localStorage.setItem('access_token', 'tok-1');

    expect(storageApi.getThumbnailUrl(null)).toBeNull();
    expect(storageApi.getThumbnailUrl(undefined)).toBeNull();
    expect(storageApi.getThumbnailUrl('')).toBeNull();
  });
});
