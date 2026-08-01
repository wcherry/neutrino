import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { updateDocument, loadKeyPair } = vi.hoisted(() => ({
  updateDocument: vi.fn(),
  loadKeyPair: vi.fn(),
}));

vi.mock('@neutrino/search', () => ({
  IndexEngine: class {
    updateDocument = updateDocument;
  },
}));

vi.mock('@neutrino/e2e-crypto', () => ({ loadKeyPair }));

import { indexOnSave, resetIndexOnSave } from '@/lib/searchIndexUpdate';

const DOC = { id: 'doc-1', type: 'document' as const, title: 'Notes', content: 'Modesto' };

/** Let the coalescing timer fire and the queued index write settle. */
async function settle() {
  await vi.advanceTimersByTimeAsync(2_000);
}

describe('indexOnSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetIndexOnSave();
    vi.useFakeTimers();
    loadKeyPair.mockReturnValue({ publicKey: new Uint8Array(), secretKey: new Uint8Array() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-indexes what was just saved', async () => {
    indexOnSave('user-1', DOC);
    await settle();

    expect(updateDocument).toHaveBeenCalledTimes(1);
    expect(updateDocument.mock.calls[0][0]).toMatchObject({
      id: 'doc-1',
      type: 'document',
      title: 'Notes',
      content: 'Modesto',
    });
  });

  it('does not index until the save has settled', () => {
    indexOnSave('user-1', DOC);
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('coalesces a burst of autosaves into one re-index', async () => {
    indexOnSave('user-1', { ...DOC, content: 'first' });
    indexOnSave('user-1', { ...DOC, content: 'second' });
    indexOnSave('user-1', { ...DOC, content: 'third' });
    await settle();

    expect(updateDocument).toHaveBeenCalledTimes(1);
    expect(updateDocument.mock.calls[0][0]).toMatchObject({ content: 'third' });
  });

  it('keeps documents independent when several are open', async () => {
    indexOnSave('user-1', DOC);
    indexOnSave('user-1', { ...DOC, id: 'sheet-1', type: 'spreadsheet' });
    await settle();

    expect(updateDocument.mock.calls.map((c) => c[0].id).sort()).toEqual(['doc-1', 'sheet-1']);
  });

  it('uses the saved revision timestamp when the caller has one', async () => {
    indexOnSave('user-1', { ...DOC, updatedAt: 1_700_000_000_000 });
    await settle();

    expect(updateDocument.mock.calls[0][0].updatedAt).toBe(1_700_000_000_000);
  });

  it('skips indexing when the device has no E2EE keys', async () => {
    loadKeyPair.mockReturnValue(null);

    indexOnSave('user-1', DOC);
    await settle();

    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('skips indexing when there is no signed-in user', async () => {
    indexOnSave(undefined, DOC);
    await settle();

    expect(updateDocument).not.toHaveBeenCalled();
  });

  it('swallows index failures so a successful save still reports success', async () => {
    updateDocument.mockRejectedValueOnce(new Error('IDB is gone'));

    indexOnSave('user-1', DOC);
    await expect(settle()).resolves.not.toThrow();

    // The next save still gets indexed — one failure doesn't wedge the queue.
    updateDocument.mockResolvedValueOnce(undefined);
    indexOnSave('user-1', DOC);
    await settle();
    expect(updateDocument).toHaveBeenCalledTimes(2);
  });
});
