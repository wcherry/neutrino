'use client';

/**
 * useFileSync
 *
 * Keeps an open file in sync with edits made elsewhere — another user, or the
 * same user on another device — without a manual refresh.
 *
 * The file relay (`/api/v1/files/{id}/ws`) only carries a *signal*: "this file
 * changed, and it wasn't you". Content itself never travels over the relay —
 * on receiving a signal the caller re-reads the file through the normal
 * (E2EE-aware) read path and decrypts it locally if needed. The endpoint is
 * generic (`src/shared/file_events/`, backed by the same `PresenceRoom`
 * primitive sheets/slides use for their own sockets), but notes is the only
 * caller today.
 *
 * Falls back to nothing on its own — callers should poll while `connected` is
 * false so a blocked/failed WebSocket degrades to eventual consistency rather
 * than no consistency.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { readVarint, encodeMessage } from '@neutrino/collab-core';
import { refreshTokensOnce } from '@neutrino/api-core';

/** Message type for the file-updated signal (`1` is awareness, as elsewhere). */
const MSG_FILE_UPDATED = 2;

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

interface FileUpdatedPayload {
  /** Sender's client id — used to ignore the echo of our own broadcast. */
  clientId: string;
}

function getStoredToken(): string {
  return typeof window !== 'undefined' ? (localStorage.getItem('access_token') ?? '') : '';
}

function isTokenExpired(token: string): boolean {
  if (!token) return true;
  try {
    // JWT payload is the second base64url segment
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    // Give a 15-second buffer so we don't connect with a token about to expire
    return (payload.exp as number) * 1000 < Date.now() + 15_000;
  } catch {
    return true;
  }
}

export interface UseFileSyncOptions {
  fileId: string;
  enabled?: boolean;
  /**
   * Called when a peer reports that the file changed. Held in a ref so the
   * WebSocket never has to be torn down just because the handler identity
   * changed between renders.
   */
  onRemoteUpdateRef?: MutableRefObject<(() => void) | null>;
}

export interface UseFileSyncResult {
  /** True while the relay socket is open. */
  connected: boolean;
  /** Tell peers this file just changed. No-op when the socket is not open. */
  broadcastFileUpdate: () => void;
}

export function useFileSync({
  fileId,
  enabled = true,
  onRemoteUpdateRef,
}: UseFileSyncOptions): UseFileSyncResult {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientIdRef = useRef<string>(
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );

  const broadcastFileUpdate = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload: FileUpdatedPayload = { clientId: clientIdRef.current };
    ws.send(encodeMessage(MSG_FILE_UPDATED, new TextEncoder().encode(JSON.stringify(payload))));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled || !fileId) return;

    async function connect() {
      if (!mountedRef.current) return;

      // WebSockets cannot set Authorization headers, so the token goes in the
      // query string. Refresh it first if it is expired or close to expiry.
      if (isTokenExpired(getStoredToken())) {
        const refreshed = await refreshTokensOnce();
        if (!refreshed || isTokenExpired(getStoredToken())) return;
      }
      if (!mountedRef.current) return;

      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const token = encodeURIComponent(getStoredToken());
      const ws = new WebSocket(
        `${scheme}://${window.location.host}/api/v1/files/${fileId}/ws?token=${token}`
      );
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        if (mountedRef.current) setConnected(true);
      };

      ws.onmessage = (event: MessageEvent) => {
        if (!(event.data instanceof ArrayBuffer)) return;
        const data = new Uint8Array(event.data);
        if (data.length === 0) return;

        const [msgType, offset] = readVarint(data, 0);
        if (msgType !== MSG_FILE_UPDATED) return;

        try {
          const parsed = JSON.parse(
            new TextDecoder().decode(data.slice(offset))
          ) as FileUpdatedPayload;
          if (parsed.clientId === clientIdRef.current) return;
          onRemoteUpdateRef?.current?.();
        } catch {
          // ignore malformed update signals
        }
      };

      ws.onerror = () => {
        // onclose fires too — reconnecting is handled there.
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!mountedRef.current) return;
        setConnected(false);
        const delay = Math.min(
          RECONNECT_BASE_MS * 2 ** attemptRef.current,
          RECONNECT_MAX_MS
        );
        attemptRef.current += 1;
        reconnectTimerRef.current = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [enabled, fileId, onRemoteUpdateRef]);

  return { connected, broadcastFileUpdate };
}
