/**
 * Tests for useFileSync — the file live-update relay client.
 *
 * The relay carries a signal only ("this file changed"), never file content,
 * so these tests assert the wire format, the self-echo guard, and that a
 * remote signal reaches the caller's handler.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { readVarint } from '@neutrino/collab-core';

vi.mock('@neutrino/api-core', () => ({
  refreshTokensOnce: vi.fn(async () => true),
}));

import { useFileSync } from '@/hooks/useFileSync';

const FILE_ID = 'file-1';

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
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
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

  /** Deliver a binary frame to the hook, as the server would. */
  receive(bytes: Uint8Array) {
    this.onmessage?.({ data: bytes.buffer } as MessageEvent);
  }
}

function encodeSignal(clientId: string): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify({ clientId }));
  const buf = new Uint8Array(payload.length + 1);
  buf[0] = 2; // MSG_FILE_UPDATED
  buf.set(payload, 1);
  return buf;
}

function decodeSignal(bytes: Uint8Array): { type: number; payload: Record<string, unknown> } {
  const [type, offset] = readVarint(bytes, 0);
  return { type, payload: JSON.parse(new TextDecoder().decode(bytes.slice(offset))) };
}

function makeUnexpiredToken(): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `header.${payload}.signature`;
}

async function connectHook() {
  const onRemoteUpdateRef = { current: vi.fn() as (() => void) | null };
  const hook = renderHook(() =>
    useFileSync({ fileId: FILE_ID, onRemoteUpdateRef })
  );

  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  const ws = FakeWebSocket.instances[0];
  await act(async () => { ws.onopen?.(); });

  return { hook, ws, handler: onRemoteUpdateRef.current as unknown as ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  localStorage.setItem('access_token', makeUnexpiredToken());
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFileSync', () => {
  it('connects to the file relay with the access token', async () => {
    const token = localStorage.getItem('access_token') as string;
    const { ws } = await connectHook();

    expect(ws.url).toContain(`/api/v1/files/${FILE_ID}/ws`);
    expect(ws.url).toContain(`token=${encodeURIComponent(token)}`);
  });

  it('reports connected once the socket is open', async () => {
    const { hook } = await connectHook();

    expect(hook.result.current.connected).toBe(true);
  });

  it('broadcasts a content-free update signal', async () => {
    const { hook, ws } = await connectHook();

    act(() => hook.result.current.broadcastFileUpdate());

    expect(ws.sent).toHaveLength(1);
    const { type, payload } = decodeSignal(ws.sent[0]);
    expect(type).toBe(2);
    // The signal must carry an identity and nothing else — no file content.
    expect(Object.keys(payload)).toEqual(['clientId']);
    expect(typeof payload.clientId).toBe('string');
  });

  it("invokes the caller's handler on a peer's update signal", async () => {
    const { ws, handler } = await connectHook();

    await act(async () => { ws.receive(encodeSignal('some-other-client')); });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignores the echo of its own broadcast', async () => {
    const { hook, ws, handler } = await connectHook();

    act(() => hook.result.current.broadcastFileUpdate());
    const ownClientId = decodeSignal(ws.sent[0]).payload.clientId as string;

    await act(async () => { ws.receive(encodeSignal(ownClientId)); });

    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores message types other than the update signal', async () => {
    const { ws, handler } = await connectHook();

    const awareness = new Uint8Array([1, ...new TextEncoder().encode('{}')]);
    await act(async () => { ws.receive(awareness); });

    expect(handler).not.toHaveBeenCalled();
  });

  it('closes the socket on unmount', async () => {
    const { hook, ws } = await connectHook();

    hook.unmount();

    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it('does not connect when disabled', async () => {
    renderHook(() => useFileSync({ fileId: FILE_ID, enabled: false }));

    await new Promise((r) => setTimeout(r, 0));
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});
