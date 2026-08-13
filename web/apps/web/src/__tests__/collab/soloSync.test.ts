/**
 * Collab sync only runs when somebody else is in the room.
 *
 * Every editor keeps its presence (awareness) socket chatty — that is how a
 * peer's arrival is noticed — but document content is held back while this
 * client is alone, then handed over on arrival. These tests pin both halves:
 * nothing on the wire when solo, and nothing lost when the room fills up.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { readVarint } from '@neutrino/collab-core';

import { useSheetPresence, type CellSyncItem } from '@/hooks/useSheetPresence';
import { useSlidePresence } from '@/hooks/useSlidePresence';
import { usePresence } from '@/hooks/usePresence';

const TOKEN = 'test-token';

// ---------------------------------------------------------------------------
// Fake WebSocket
// ---------------------------------------------------------------------------

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  url: string;
  binaryType = '';
  readyState = FakeWebSocket.OPEN;
  sent: Uint8Array[] = [];

  onopen: (() => void) | null = null;
  onclose: ((e?: unknown) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: Uint8Array) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  receive(bytes: Uint8Array) {
    this.onmessage?.({ data: bytes.buffer } as MessageEvent);
  }
}

/** Messages of the given top-level type, payload decoded as JSON. */
function jsonMessages(ws: FakeWebSocket, type: number): Record<string, unknown>[] {
  return ws.sent
    .map((bytes) => {
      const [msgType, offset] = readVarint(bytes, 0);
      if (msgType !== type) return null;
      return JSON.parse(new TextDecoder().decode(bytes.slice(offset))) as Record<string, unknown>;
    })
    .filter((m): m is Record<string, unknown> => m !== null);
}

/** Yjs sync messages (top-level type 0) of the given sub-type. */
function syncMessages(ws: FakeWebSocket, subType: number): Uint8Array[] {
  return ws.sent.filter((bytes) => {
    const [msgType, offset] = readVarint(bytes, 0);
    if (msgType !== 0) return false;
    return readVarint(bytes, offset)[0] === subType;
  });
}

/** An awareness frame as the server relays it from another client. */
function peerAwareness(clientId: string, extra: Record<string, unknown> = {}): Uint8Array {
  const payload = new TextEncoder().encode(
    JSON.stringify({
      clientId,
      user: { name: 'Peer', color: '#1e40af' },
      cursor: null,
      joinedAt: Date.now() + 1000,
      ...extra,
    })
  );
  const buf = new Uint8Array(payload.length + 1);
  buf[0] = 1; // awareness
  buf.set(payload, 1);
  return buf;
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

describe('useSheetPresence — cell sync', () => {
  async function connect() {
    const hook = renderHook(() =>
      useSheetPresence({ sheetId: 's1', userName: 'Me', authToken: TOKEN, enabled: true })
    );
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const ws = FakeWebSocket.instances[0];
    await act(async () => { ws.onopen?.(); });
    ws.sent = []; // drop the opening awareness announce
    return { hook, ws };
  }

  const cell = (id: string, raw: string): CellSyncItem => ({ id, raw });

  it('sends nothing while alone in the room', async () => {
    const { hook, ws } = await connect();

    act(() => hook.result.current.broadcastCells(0, [cell('A1', 'hello')]));

    expect(jsonMessages(ws, 2)).toHaveLength(0);
  });

  it('hands over the cells edited while alone when a peer joins', async () => {
    const { hook, ws } = await connect();

    act(() => hook.result.current.broadcastCells(0, [cell('A1', 'first')]));
    act(() => hook.result.current.broadcastCells(0, [cell('A1', 'second'), cell('B2', 'other')]));
    await act(async () => { ws.receive(peerAwareness('peer-1')); });

    await waitFor(() => expect(jsonMessages(ws, 2)).toHaveLength(1));
    const [update] = jsonMessages(ws, 2);
    expect(update.sheetIndex).toBe(0);
    // Latest value per cell, not one message per edit.
    expect(update.cells).toEqual([cell('A1', 'second'), cell('B2', 'other')]);
  });

  it('sends immediately once a peer is present', async () => {
    const { hook, ws } = await connect();
    await act(async () => { ws.receive(peerAwareness('peer-1')); });
    await waitFor(() => expect(hook.result.current.remoteUsers).toHaveLength(1));

    act(() => hook.result.current.broadcastCells(1, [cell('C3', 'live')]));

    const updates = jsonMessages(ws, 2);
    expect(updates).toHaveLength(1);
    expect(updates[0].cells).toEqual([cell('C3', 'live')]);
  });
});

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

describe('useSlidePresence — presentation sync', () => {
  async function connect() {
    const hook = renderHook(() =>
      useSlidePresence({ slideId: 'p1', userName: 'Me', authToken: TOKEN, enabled: true })
    );
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const ws = FakeWebSocket.instances[0];
    await act(async () => { ws.onopen?.(); });
    ws.sent = [];
    return { hook, ws };
  }

  it('sends nothing while alone in the room', async () => {
    const { hook, ws } = await connect();

    act(() => hook.result.current.broadcastPresentation({ slides: [1] }));

    expect(jsonMessages(ws, 2)).toHaveLength(0);
  });

  it('hands over the newest presentation when a peer joins', async () => {
    const { hook, ws } = await connect();

    act(() => hook.result.current.broadcastPresentation({ slides: [1] }));
    act(() => hook.result.current.broadcastPresentation({ slides: [1, 2] }));
    await act(async () => { ws.receive(peerAwareness('peer-1')); });

    await waitFor(() => expect(jsonMessages(ws, 2)).toHaveLength(1));
    expect(jsonMessages(ws, 2)[0].presentation).toEqual({ slides: [1, 2] });
  });

  it('sends immediately once a peer is present', async () => {
    const { hook, ws } = await connect();
    await act(async () => { ws.receive(peerAwareness('peer-1')); });
    await waitFor(() => expect(hook.result.current.remoteUsers).toHaveLength(1));

    act(() => hook.result.current.broadcastPresentation({ slides: [9] }));

    expect(jsonMessages(ws, 2)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Docs
// ---------------------------------------------------------------------------

describe('usePresence — Y.Doc sync', () => {
  async function connect(ydoc: Y.Doc) {
    const hook = renderHook(() =>
      usePresence({ docId: 'd1', userName: 'Me', authToken: TOKEN, editor: null, enabled: true, ydoc })
    );
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const ws = FakeWebSocket.instances[0];
    await act(async () => { ws.onopen?.(); });
    ws.sent = []; // drop SyncStep1 and the opening awareness announce
    return { hook, ws };
  }

  it('sends the first update — the seed — then holds the rest back while alone', async () => {
    const ydoc = new Y.Doc();
    const { ws } = await connect(ydoc);

    // The editor seeding the doc from the stored file. Without this reaching
    // the server, a client connecting later would find the room empty and seed
    // a second, divergent copy.
    act(() => { ydoc.getText('content').insert(0, 'seed'); });
    expect(syncMessages(ws, 2)).toHaveLength(1);

    act(() => { ydoc.getText('content').insert(4, ' typing'); });
    act(() => { ydoc.getText('content').insert(11, ' more'); });

    expect(syncMessages(ws, 2)).toHaveLength(1);
  });

  it('flushes the held-back state when a peer joins', async () => {
    const ydoc = new Y.Doc();
    const { ws } = await connect(ydoc);
    act(() => { ydoc.getText('content').insert(0, 'seed'); });
    act(() => { ydoc.getText('content').insert(4, ' typed alone'); });
    ws.sent = [];

    await act(async () => { ws.receive(peerAwareness('peer-1')); });

    await waitFor(() => expect(syncMessages(ws, 2)).toHaveLength(1));
    // Full state, so the peer sees everything typed before it arrived.
    const applied = new Y.Doc();
    const [, offset] = readVarint(syncMessages(ws, 2)[0], 0);
    const [, afterSub] = readVarint(syncMessages(ws, 2)[0], offset);
    const [len, afterLen] = readVarint(syncMessages(ws, 2)[0], afterSub);
    Y.applyUpdate(applied, syncMessages(ws, 2)[0].slice(afterLen, afterLen + len));
    expect(applied.getText('content').toString()).toBe('seed typed alone');
  });

  it('flushes the held-back state when the session ends', async () => {
    const ydoc = new Y.Doc();
    const { hook, ws } = await connect(ydoc);
    act(() => { ydoc.getText('content').insert(0, 'seed'); });
    act(() => { ydoc.getText('content').insert(4, ' typed alone'); });
    ws.sent = [];

    // The server persists the room's Y.Doc when the last session leaves and
    // seeds the next one from it, so leaving without flushing would strand the
    // solo edits behind a stale copy.
    act(() => { hook.unmount(); });

    expect(syncMessages(ws, 2)).toHaveLength(1);
  });

  it('sends updates immediately once a peer is present', async () => {
    const ydoc = new Y.Doc();
    const { ws } = await connect(ydoc);
    await act(async () => { ws.receive(peerAwareness('peer-1')); });
    ws.sent = [];

    act(() => { ydoc.getText('content').insert(0, 'a'); });
    act(() => { ydoc.getText('content').insert(1, 'b'); });

    expect(syncMessages(ws, 2)).toHaveLength(2);
  });
});
