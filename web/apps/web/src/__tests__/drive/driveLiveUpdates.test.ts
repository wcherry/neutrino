import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  DRIVE_CHANGED_TYPE,
  LISTING_QUERY_KEYS,
  invalidateDriveListings,
  parseDriveChangedSignal,
} from '@/lib/driveLiveUpdates';

// ---------------------------------------------------------------------------
// Live drive updates — the client half of `shared::drive_events`.
//
// The bug these guard against is silent in both directions: a signal mistaken for an inbox record
// puts a phantom notification in the bell, and a listing key left out of the set goes stale with
// nothing to show for it.
// ---------------------------------------------------------------------------

describe('parseDriveChangedSignal', () => {
  it('reads a drive-change signal', () => {
    const signal = parseDriveChangedSignal({
      type: DRIVE_CHANGED_TYPE,
      originClientId: 'tab-a',
    });

    expect(signal).toEqual({ type: DRIVE_CHANGED_TYPE, originClientId: 'tab-a' });
  });

  it('reads a signal the server attributed to nobody', () => {
    const signal = parseDriveChangedSignal({
      type: DRIVE_CHANGED_TYPE,
      originClientId: null,
    });

    expect(signal?.originClientId).toBeNull();
  });

  /**
   * The two kinds of message share one socket and are told apart by `type` being absent on an
   * inbox record. If this ever stopped holding, every share and mention would be dropped instead
   * of reaching the bell.
   */
  it('does not mistake a notification inbox record for a signal', () => {
    const notification = {
      id: 'n1',
      recipientId: 'u1',
      eventType: 'file_shared',
      payload: { resourceId: 'f1' },
      isRead: false,
      createdAt: '2026-09-12 10:00:00',
    };

    expect(parseDriveChangedSignal(notification)).toBeNull();
  });

  it('ignores a message kind it does not recognise', () => {
    expect(parseDriveChangedSignal({ type: 'something.else' })).toBeNull();
    expect(parseDriveChangedSignal(null)).toBeNull();
    expect(parseDriveChangedSignal('drive.changed')).toBeNull();
    expect(parseDriveChangedSignal(42)).toBeNull();
  });

  it('treats a non-string origin as no origin rather than trusting it', () => {
    const signal = parseDriveChangedSignal({
      type: DRIVE_CHANGED_TYPE,
      originClientId: { nested: 'object' },
    });

    expect(signal?.originClientId).toBeNull();
  });
});

describe('invalidateDriveListings', () => {
  /**
   * Every Drive view, every office-suite landing page and every hand-written listing, by the key
   * root each actually uses. Kept here as literals rather than mapped from `LISTING_QUERY_KEYS`,
   * so a key deleted from that list fails this test instead of silently agreeing with it.
   */
  const LISTING_KEYS_IN_USE = [
    ['contents', 'folder-1', 'user-1', { orderBy: 'name' }],
    ['recent'],
    ['starred'],
    ['starred-page'],
    ['shared-with-me'],
    ['trash'],
    ['tags'],
    ['tag-files', 'tag-1'],
    ['move-folder-browse', 'folder-1', 'user-1'],
    ['move-team-browse', 'team-1', 'folder-1'],
    ['team-library', 'team-1', null],
    ['team-shares', 'team-1'],
    ['docs'],
    ['sheets'],
    ['slides'],
    ['drawings'],
    ['notes'],
    ['diagrams'],
    ['photos', 'library'],
    ['photo-motion'],
    ['albums'],
  ];

  function clientWith(keys: unknown[][]): QueryClient {
    const client = new QueryClient();
    keys.forEach((key, i) => client.setQueryData(key, { seeded: i }));
    return client;
  }

  it.each(LISTING_KEYS_IN_USE)('invalidates %j', async (...key) => {
    const client = clientWith([key]);

    await invalidateDriveListings(client);

    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });

  /**
   * A file's own versions, tags, comments and permissions are read when that file is opened; none
   * of them is what goes stale behind somebody else's upload, and invalidating them would turn one
   * signal into a burst of unrelated reads.
   */
  it.each([
    [['file-versions', 'f1']],
    [['file-tags', 'f1']],
    [['note', 'n1']],
    [['note-content', 'n1']],
    [['team-members', 't1']],
    [['profile-details']],
    [['events']],
    [['persons']],
  ])('leaves %j alone', async (key) => {
    const client = clientWith([key]);

    await invalidateDriveListings(client);

    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it('invalidates every page of an infinite folder listing at once', async () => {
    // My Drive's key carries the folder, the user and the sort/filter, so a predicate over the
    // root is what reaches the listing the user actually has open.
    const client = clientWith([
      ['contents', 'folder-1', 'user-1', { orderBy: 'name', direction: 'asc', type: undefined }],
      ['contents', 'folder-2', 'user-1', { orderBy: 'modified', direction: 'desc', type: 'image' }],
    ]);

    await invalidateDriveListings(client);

    expect(
      client
        .getQueryCache()
        .getAll()
        .every((q) => q.state.isInvalidated)
    ).toBe(true);
  });

  it('ignores a query whose key does not start with a string', async () => {
    const client = clientWith([[{ scope: 'contents' }]]);

    await expect(invalidateDriveListings(client)).resolves.not.toThrow();
  });

  it('lists no key twice', () => {
    expect(new Set(LISTING_QUERY_KEYS).size).toBe(LISTING_QUERY_KEYS.length);
  });
});
