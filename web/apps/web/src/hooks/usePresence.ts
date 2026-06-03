'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Editor } from '@tiptap/react';

// ── Wire protocol helpers ──────────────────────────────────────────────────────
// The backend collab WS (src/docs/collab/api.rs) forwards awareness messages
// verbatim. Awareness message wire format: [varint 1][payload_bytes].
// We use a simple JSON payload (not the binary Yjs awareness CRDT) since the
// backend just relays bytes between clients without interpretation.

function writeVarint(n: number): number[] {
  const bytes: number[] = [];
  let value = n;
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return bytes;
}

function readVarint(data: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < data.length) {
    const byte = data[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [result, pos];
}

function encodeAwarenessMessage(payload: Uint8Array): Uint8Array {
  const typeBytes = writeVarint(1); // messageAwareness = 1
  const buf = new Uint8Array(typeBytes.length + payload.length);
  buf.set(typeBytes, 0);
  buf.set(payload, typeBytes.length);
  return buf;
}

function decodeAwarenessPayload(data: Uint8Array): Uint8Array | null {
  const [msgType, offset] = readVarint(data, 0);
  if (msgType !== 1) return null; // not an awareness message
  return data.slice(offset);
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RemoteUser {
  clientId: string;
  name: string;
  color: string;
  cursor: { anchor: number; head: number } | null;
}

export interface PresenceState {
  remoteUsers: RemoteUser[];
  isConnected: boolean;
}

// Predefined colors for remote users (cycled by clientId hash)
const PRESENCE_COLORS = [
  '#1a73e8', '#e53935', '#43a047', '#fb8c00',
  '#8e24aa', '#00acc1', '#6d4c41', '#546e7a',
];

function hashColor(clientId: string): string {
  let h = 0;
  for (let i = 0; i < clientId.length; i++) {
    h = (h * 31 + clientId.charCodeAt(i)) >>> 0;
  }
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length];
}

// ── Hook ───────────────────────────────────────────────────────────────────────

interface UsePresenceOptions {
  docId: string;
  userName: string;
  /** JWT access token for WebSocket authentication. */
  authToken: string | null;
  editor: Editor | null;
  /** Whether the feature flag is enabled. */
  enabled: boolean;
}

export function usePresence({
  docId,
  userName,
  authToken,
  editor,
  enabled,
}: UsePresenceOptions): PresenceState {
  const [remoteUsers, setRemoteUsers] = useState<RemoteUser[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
  const myColor = hashColor(clientIdRef.current);

  // Send our cursor position / awareness state to peers
  const sendAwareness = useCallback(
    (cursor: { anchor: number; head: number } | null) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const payload = {
        clientId: clientIdRef.current,
        user: { name: userName, color: myColor },
        cursor,
      };
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
      const msg = encodeAwarenessMessage(payloadBytes);
      ws.send(msg);
    },
    [userName, myColor]
  );

  // Connect WebSocket
  useEffect(() => {
    if (!enabled || !docId || !authToken) return;

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/v1/docs/${docId}/ws?token=${encodeURIComponent(authToken)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      // Announce ourselves immediately
      sendAwareness(null);
    };

    ws.onclose = () => {
      setIsConnected(false);
      setRemoteUsers([]);
    };

    ws.onerror = () => {
      setIsConnected(false);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const data = new Uint8Array(event.data);
      const payload = decodeAwarenessPayload(data);
      if (!payload) return;

      try {
        const parsed = JSON.parse(new TextDecoder().decode(payload)) as {
          clientId: string;
          user: { name: string; color: string };
          cursor: { anchor: number; head: number } | null;
        };

        // Ignore our own messages
        if (parsed.clientId === clientIdRef.current) return;

        setRemoteUsers(prev => {
          const filtered = prev.filter(u => u.clientId !== parsed.clientId);
          // null cursor means user left or cleared presence — keep them in the
          // list briefly so we don't flash avatars in/out
          const updated: RemoteUser = {
            clientId: parsed.clientId,
            name: parsed.user.name,
            color: parsed.user.color || hashColor(parsed.clientId),
            cursor: parsed.cursor,
          };
          return [...filtered, updated];
        });
      } catch {
        // Ignore malformed messages (could be Yjs sync messages from the same
        // connection if the editor also uses Yjs collaboration in the future)
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setIsConnected(false);
      setRemoteUsers([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, docId, authToken]);

  // Broadcast cursor position whenever the editor selection changes
  useEffect(() => {
    if (!enabled || !editor) return;

    const onSelectionUpdate = () => {
      const { anchor, head } = editor.state.selection;
      sendAwareness({ anchor, head });
    };

    editor.on('selectionUpdate', onSelectionUpdate);
    return () => {
      editor.off('selectionUpdate', onSelectionUpdate);
    };
  }, [enabled, editor, sendAwareness]);

  // Send a "null cursor" / disconnection message when the component unmounts
  useEffect(() => {
    return () => {
      sendAwareness(null);
    };
  }, [sendAwareness]);

  return { remoteUsers, isConnected };
}
