'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface SheetRemoteUser {
  clientId: string;
  name: string;
  color: string;
}

const HEARTBEAT_INTERVAL_MS = 10_000;
const STALE_TIMEOUT_MS = 30_000;
const STALE_CHECK_INTERVAL_MS = 5_000;

interface AwarenessPayload {
  clientId: string;
  user: { name: string; color: string };
  cursor: null;
  disconnecting?: boolean;
  joinedAt?: number;
}

// Mirrors Avatar's getColorIndex so presence avatars match — same palette as usePresence
const AVATAR_TEXT_COLORS = [
  '#1e40af',
  '#166534',
  '#92400e',
  '#991b1b',
  '#4c1d95',
  '#701a75',
  '#9a3412',
  '#065f46',
];

function colorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_TEXT_COLORS[Math.abs(hash) % AVATAR_TEXT_COLORS.length];
}

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
  const typeBytes = writeVarint(1);
  const buf = new Uint8Array(typeBytes.length + payload.length);
  buf.set(typeBytes, 0);
  buf.set(payload, typeBytes.length);
  return buf;
}

export function useSheetPresence({
  sheetId,
  userName,
  authToken,
  enabled,
}: {
  sheetId: string;
  userName: string;
  authToken: string | null;
  enabled: boolean;
}): SheetRemoteUser[] {
  const [remoteUsers, setRemoteUsers] = useState<SheetRemoteUser[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
  const localJoinedAtRef = useRef<number>(Date.now());
  const lastSeenRef = useRef<Map<string, number>>(new Map());
  const myColor = colorFromName(userName);

  const sendAwareness = useCallback(
    (cursor: null, disconnecting = false) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const payload: AwarenessPayload = {
        clientId: clientIdRef.current,
        user: { name: userName, color: myColor },
        cursor,
        joinedAt: localJoinedAtRef.current,
        ...(disconnecting ? { disconnecting: true } : {}),
      };
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
      ws.send(encodeAwarenessMessage(payloadBytes));
    },
    [userName, myColor]
  );

  const sendAwarenessRef = useRef(sendAwareness);
  useEffect(() => { sendAwarenessRef.current = sendAwareness; }, [sendAwareness]);

  useEffect(() => {
    if (!enabled || !sheetId || !authToken) return;

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/v1/sheets/${sheetId}/ws?token=${encodeURIComponent(authToken)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      sendAwareness(null);
    };

    ws.onclose = () => {
      setRemoteUsers([]);
      lastSeenRef.current.clear();
    };

    ws.onerror = () => {
      // connection will also fire onclose; clearing state there is sufficient
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const data = new Uint8Array(event.data);
      if (data.length === 0) return;

      const [msgType, offset] = readVarint(data, 0);
      if (msgType !== 1) return; // only awareness messages matter for sheets presence

      const payload = data.slice(offset);
      try {
        const parsed = JSON.parse(new TextDecoder().decode(payload)) as AwarenessPayload;
        if (parsed.clientId === clientIdRef.current) return;

        if (parsed.disconnecting) {
          lastSeenRef.current.delete(parsed.clientId);
          setRemoteUsers(prev => prev.filter(u => u.clientId !== parsed.clientId));
          return;
        }

        const isNewPeer = !lastSeenRef.current.has(parsed.clientId);
        lastSeenRef.current.set(parsed.clientId, Date.now());
        setRemoteUsers(prev => {
          const filtered = prev.filter(u => u.clientId !== parsed.clientId);
          return [...filtered, {
            clientId: parsed.clientId,
            name: parsed.user.name,
            color: parsed.user.color || colorFromName(parsed.user.name),
          }];
        });

        if (isNewPeer) {
          sendAwarenessRef.current(null);
        }
      } catch {
        // ignore malformed awareness messages
      }
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        const leavePayload: AwarenessPayload = {
          clientId: clientIdRef.current,
          user: { name: userName, color: colorFromName(userName) },
          cursor: null,
          disconnecting: true,
        };
        const bytes = new TextEncoder().encode(JSON.stringify(leavePayload));
        ws.send(encodeAwarenessMessage(bytes));
      }
      ws.close();
      wsRef.current = null;
      setRemoteUsers([]);
      lastSeenRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sheetId, authToken]);

  // Heartbeat: re-announce presence every 10s so late joiners see us
  useEffect(() => {
    if (!enabled || !authToken) return;
    const id = setInterval(() => sendAwarenessRef.current(null), HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, authToken]);

  // Stale cleanup: remove peers not heard from in 30s
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      const now = Date.now();
      setRemoteUsers(prev => {
        const next = prev.filter(u => {
          const seen = lastSeenRef.current.get(u.clientId) ?? 0;
          if (now - seen >= STALE_TIMEOUT_MS) {
            lastSeenRef.current.delete(u.clientId);
            return false;
          }
          return true;
        });
        return next.length === prev.length ? prev : next;
      });
    }, STALE_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled]);

  // Announce departure on tab close
  useEffect(() => {
    const handleBeforeUnload = () => sendAwarenessRef.current(null, true);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  return remoteUsers;
}
