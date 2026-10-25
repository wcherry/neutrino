/**
 * The bounded worker pool behind a local import (`lib/localImport/pool.ts`).
 *
 * Each running upload holds one file in memory to encrypt it, so the limit is
 * what bounds the tab's memory on a 10,000-file import. Abort is "stop after
 * the item you are on": nothing new starts, nothing in flight is torn down.
 */

import { describe, it, expect } from 'vitest';
import { runPool } from '@/lib/localImport/pool';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (e: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let queued microtasks (worker starts after a settle) run. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * A worker whose items finish only when the test says so, tracking how many
 * are in flight at once.
 */
function controlledWorker() {
  const pending = new Map<number, Deferred>();
  const started: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const worker = (_item: unknown, index: number) => {
    started.push(index);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const d = deferred();
    pending.set(index, d);
    return d.promise.finally(() => {
      inFlight--;
    });
  };
  return {
    worker,
    started,
    finish: async (index: number) => {
      pending.get(index)!.resolve();
      await flush();
    },
    fail: async (index: number, err: unknown = new Error('boom')) => {
      pending.get(index)!.reject(err);
      await flush();
    },
    get inFlight() {
      return inFlight;
    },
    get maxInFlight() {
      return maxInFlight;
    },
  };
}

describe('runPool', () => {
  it('never runs more than `limit` workers at once', async () => {
    const w = controlledWorker();
    const items = Array.from({ length: 10 }, (_, i) => i);
    const done = runPool(items, 3, w.worker);
    await flush();

    expect(w.inFlight).toBe(3);
    for (let i = 0; i < 10; i++) {
      await w.finish(i);
      expect(w.inFlight).toBeLessThanOrEqual(3);
    }
    await done;

    expect(w.maxInFlight).toBe(3);
  });

  it('processes every item exactly once, passing its index', async () => {
    const seen: [string, number][] = [];
    await runPool(['a', 'b', 'c', 'd', 'e'], 2, async (item, index) => {
      seen.push([item, index]);
    });
    expect(seen.sort((x, y) => x[1] - y[1])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 3],
      ['e', 4],
    ]);
  });

  it('resolves immediately for no items', async () => {
    let calls = 0;
    await runPool([], 3, async () => {
      calls++;
    });
    expect(calls).toBe(0);
  });

  it('keeps going past a worker that rejects, and still resolves', async () => {
    const seen: number[] = [];
    await expect(
      runPool([0, 1, 2, 3], 2, async (_item, index) => {
        seen.push(index);
        if (index === 1) throw new Error('one bad file');
      }),
    ).resolves.toBeUndefined();
    expect(seen.sort()).toEqual([0, 1, 2, 3]);
  });

  it('starts nothing new after abort, but lets in-flight items finish', async () => {
    const w = controlledWorker();
    const controller = new AbortController();
    let settled = false;
    const done = runPool(
      Array.from({ length: 6 }, (_, i) => i),
      2,
      w.worker,
      controller.signal,
    ).then(() => {
      settled = true;
    });
    await flush();
    expect(w.started).toEqual([0, 1]);

    controller.abort();
    await w.finish(0);
    // Item 0 finishing would normally start item 2; aborted, it must not.
    expect(w.started).toEqual([0, 1]);
    // Item 1 is still in flight, so the pool has not resolved yet.
    expect(settled).toBe(false);

    await w.finish(1);
    await done;
    expect(settled).toBe(true);
    expect(w.started).toEqual([0, 1]);
  });

  it('starts nothing when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    await runPool([1, 2, 3], 2, async () => {
      calls++;
    }, controller.signal);
    expect(calls).toBe(0);
  });

  it.each([0, -1])('treats a limit of %i as 1', async (limit) => {
    const w = controlledWorker();
    const done = runPool([0, 1, 2], limit, w.worker);
    await flush();
    expect(w.inFlight).toBe(1);
    await w.finish(0);
    await w.finish(1);
    await w.finish(2);
    await done;
    expect(w.maxInFlight).toBe(1);
    expect(w.started).toEqual([0, 1, 2]);
  });
});
