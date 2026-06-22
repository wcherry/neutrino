'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { MutableRefObject } from 'react';

export interface SlideRemoteUser {
  clientId: string;
  name: string;
  color: string;
  slideIndex: number | null;
}

const HEARTBEAT_INTERVAL_MS = 10_000;
const STALE_TIMEOUT_MS = 30_000;
const STALE_CHECK_INTERVAL_MS = 5_000;

interface AwarenessPayload {
  clientId: string;
  user: { name: string; color: string };
  cursor: { slideIndex: number } | null;
  disconnecting?: boolean;
  joinedAt?: number;
}

interface PresentationUpdatePayload {
  clientId: string;
  presentation: unknown;
}

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

function encodeMessage(type: number, payload: Uint8Array): Uint8Array {
  const typeBytes = writeVarint(type);
  const buf = new Uint8Array(typeBytes.length + payload.length);
  buf.set(typeBytes, 0);
  buf.set(payload, typeBytes.length);
  return buf;
}

export function useSlidePresence({
  slideId,
  userName,
  authToken,
  enabled,
  selectedSlideIndex,
  onRemotePresentationRef,
}: {
  slideId: string;
  userName: string;
  authToken: string | null;
  enabled: boolean;
  selectedSlideIndex?: number;
  onRemotePresentationRef?: MutableRefObject<((presentation: unknown) => void) | null>;
}): { remoteUsers: SlideRemoteUser[]; broadcastPresentation: (presentation: unknown) => void } {
  const [remoteUsers, setRemoteUsers] = useState<SlideRemoteUser[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
  const localJoinedAtRef = useRef<number>(Date.now());
  const lastSeenRef = useRef<Map<string, number>>(new Map());
  const myColor = colorFromName(userName);
  const selectedSlideIndexRef = useRef<number | null>(selectedSlideIndex ?? null);
  useEffect(() => { selectedSlideIndexRef.current = selectedSlideIndex ?? null; }, [selectedSlideIndex]);

  const sendAwareness = useCallback(
    (disconnecting = false) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const payload: AwarenessPayload = {
        clientId: clientIdRef.current,
        user: { name: userName, color: myColor },
        cursor: selectedSlideIndexRef.current != null ? { slideIndex: selectedSlideIndexRef.current } : null,
        joinedAt: localJoinedAtRef.current,
        ...(disconnecting ? { disconnecting: true } : {}),
      };
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
      ws.send(encodeMessage(1, payloadBytes));
    },
    [userName, myColor]
  );

  const broadcastPresentation = useCallback((presentation: unknown) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload: PresentationUpdatePayload = {
      clientId: clientIdRef.current,
      presentation,
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    ws.send(encodeMessage(2, payloadBytes));
  }, []);

  const sendAwarenessRef = useRef(sendAwareness);
  useEffect(() => { sendAwarenessRef.current = sendAwareness; }, [sendAwareness]);

  useEffect(() => {
    if (!enabled || !slideId || !authToken) return;

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/v1/slides/${slideId}/ws?token=${encodeURIComponent(authToken)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      sendAwareness();
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

      // Read varint type byte
      let offset = 0;
      let msgType = 0;
      let shift = 0;
      while (offset < data.length) {
        const byte = data[offset++];
        msgType |= (byte & 0x7f) << shift;
        shift += 7;
        if ((byte & 0x80) === 0) break;
      }

      const payload = data.slice(offset);

      if (msgType === 1) {
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
              slideIndex: parsed.cursor?.slideIndex ?? null,
            }];
          });

          if (isNewPeer) {
            sendAwarenessRef.current();
          }
        } catch {
          // ignore malformed awareness messages
        }
        return;
      }

      if (msgType === 2) {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(payload)) as PresentationUpdatePayload;
          if (parsed.clientId === clientIdRef.current) return;
          onRemotePresentationRef?.current?.(parsed.presentation);
        } catch {
          // ignore malformed presentation update messages
        }
        return;
      }
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        const leavePayload: AwarenessPayload = {
          clientId: clientIdRef.current,
          user: { name: userName, color: colorFromName(userName) },
          cursor: selectedSlideIndexRef.current != null ? { slideIndex: selectedSlideIndexRef.current } : null,
          disconnecting: true,
        };
        const bytes = new TextEncoder().encode(JSON.stringify(leavePayload));
        ws.send(encodeMessage(1, bytes));
      }
      ws.close();
      wsRef.current = null;
      setRemoteUsers([]);
      lastSeenRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, slideId, authToken]);

  // Heartbeat: re-announce presence every 10s so late joiners see us
  useEffect(() => {
    if (!enabled || !authToken) return;
    const id = setInterval(() => sendAwarenessRef.current(), HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, authToken]);

  // Broadcast when selected slide changes so peers see cursor movement immediately
  useEffect(() => {
    if (!enabled || !authToken) return;
    sendAwarenessRef.current();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlideIndex]);

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
    const handleBeforeUnload = () => sendAwarenessRef.current(true);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  return { remoteUsers, broadcastPresentation };
}
