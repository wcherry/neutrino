'use client';

import type { EditorWorkerOps, EditorWorkerReply } from './editorWorkerProtocol';

/**
 * The page's side of `editorWorker.ts`: one worker per tab, started on first use.
 *
 * `null` where there is no `Worker` (tests, old browsers) or it fails to start, so every caller
 * keeps a main-thread fallback rather than assuming the worker is there.
 */

let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();

function start(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined') return (worker = null);
  try {
    worker = new Worker(new URL('./editorWorker.ts', import.meta.url), { type: 'module', name: 'neutrino-editor' });
  } catch {
    return (worker = null);
  }
  worker.onmessage = (event: MessageEvent<EditorWorkerReply>) => {
    const reply = event.data;
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id);
    if (reply.ok) waiter.resolve(reply.value);
    else waiter.reject(new Error(reply.error));
  };
  worker.onerror = () => {
    // A worker that died takes its queue with it; fail those calls so callers fall back.
    for (const waiter of pending.values()) waiter.reject(new Error('editor worker failed'));
    pending.clear();
    worker = null;
  };
  return worker;
}

export function hasEditorWorker(): boolean {
  return start() !== null;
}

/** Runs `op` in the worker. Rejects when there is no worker; check `hasEditorWorker()` first. */
export function callEditorWorker<K extends keyof EditorWorkerOps>(
  op: K,
  args: EditorWorkerOps[K]['args'],
  transfer: Transferable[] = [],
): Promise<EditorWorkerOps[K]['result']> {
  const w = start();
  if (!w) return Promise.reject(new Error('no editor worker'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, op, args }, transfer);
  });
}
