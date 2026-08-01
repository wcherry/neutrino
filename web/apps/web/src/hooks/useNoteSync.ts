'use client';

/**
 * useNoteSync
 *
 * Keeps an open note in sync with edits made elsewhere — another user, or the
 * same user on another device — without a manual refresh.
 *
 * The note relay (`/api/v1/notes/{id}/ws`) only carries a *signal*: "this note
 * changed, and it wasn't you". Note content is end-to-end encrypted, so the
 * content itself never travels over the relay; on receiving a signal the editor
 * re-reads the note through the normal read path and decrypts it locally.
 *
 * Falls back to nothing on its own — callers should poll while `connected` is
 * false so a blocked/failed WebSocket degrades to eventual consistency rather
 * than no consistency.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { readVarint, encodeMessage } from '@neutrino/collab-core';
import { refreshTokensOnce } from '@neutrino/api-core';

/** Message type for the note-updated signal (`1` is awareness, as elsewhere). */
const MSG_NOTE_UPDATED = 2;

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

interface NoteUpdatedPayload {
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

export interface UseNoteSyncOptions {
  noteId: string;
  enabled?: boolean;
  /**
   * Called when a peer reports that the note changed. Held in a ref so the
   * WebSocket never has to be torn down just because the handler identity
   * changed between renders.
   */
  onRemoteUpdateRef?: MutableRefObject<(() => void) | null>;
}

export interface UseNoteSyncResult {
  /** True while the relay socket is open. */
  connected: boolean;
  /** Tell peers this note just changed. No-op when the socket is not open. */
  broadcastNoteUpdate: () => void;
}

export function useNoteSync({
  noteId,
  enabled = true,
  onRemoteUpdateRef,
}: UseNoteSyncOptions): UseNoteSyncResult {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientIdRef = useRef<string>(
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );

  const broadcastNoteUpdate = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload: NoteUpdatedPayload = { clientId: clientIdRef.current };
    ws.send(encodeMessage(MSG_NOTE_UPDATED, new TextEncoder().encode(JSON.stringify(payload))));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled || !noteId) return;

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
        `${scheme}://${window.location.host}/api/v1/notes/${noteId}/ws?token=${token}`
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
        if (msgType !== MSG_NOTE_UPDATED) return;

        try {
          const parsed = JSON.parse(
            new TextDecoder().decode(data.slice(offset))
          ) as NoteUpdatedPayload;
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
  }, [enabled, noteId, onRemoteUpdateRef]);

  return { connected, broadcastNoteUpdate };
}
