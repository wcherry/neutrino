'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  readVarint,
  encodeMessage,
  colorFromName,
  HEARTBEAT_INTERVAL_MS,
  STALE_TIMEOUT_MS,
  STALE_CHECK_INTERVAL_MS,
} from '@neutrino/collab-core';

export interface SheetRemoteUser {
  clientId: string;
  name: string;
  color: string;
  cellId: string | null;
}

export interface CellSyncItem {
  id: string;
  raw: string;
  cellStyle?: Record<string, unknown>;
  colSpan?: number;
  rowSpan?: number;
  mergeAnchor?: string;
}

interface CellUpdatePayload {
  clientId: string;
  sheetIndex: number;
  cells: CellSyncItem[];
}

interface AwarenessPayload {
  clientId: string;
  user: { name: string; color: string };
  cursor: { cellId: string } | null;
  disconnecting?: boolean;
  joinedAt?: number;
}

export function useSheetPresence({
  sheetId,
  userName,
  authToken,
  enabled,
  selectedCellId,
  onRemoteCellsRef,
}: {
  sheetId: string;
  userName: string;
  authToken: string | null;
  enabled: boolean;
  selectedCellId?: string | null;
  onRemoteCellsRef?: React.MutableRefObject<((sheetIndex: number, cells: CellSyncItem[]) => void) | null>;
}): { remoteUsers: SheetRemoteUser[]; broadcastCells: (sheetIndex: number, cells: CellSyncItem[]) => void } {
  const [remoteUsers, setRemoteUsers] = useState<SheetRemoteUser[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
  const localJoinedAtRef = useRef<number>(Date.now());
  const lastSeenRef = useRef<Map<string, number>>(new Map());
  const myColor = colorFromName(userName);
  const selectedCellIdRef = useRef<string | null>(selectedCellId ?? null);
  useEffect(() => { selectedCellIdRef.current = selectedCellId ?? null; }, [selectedCellId]);

  const sendAwareness = useCallback(
    (disconnecting = false) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const payload: AwarenessPayload = {
        clientId: clientIdRef.current,
        user: { name: userName, color: myColor },
        cursor: selectedCellIdRef.current ? { cellId: selectedCellIdRef.current } : null,
        joinedAt: localJoinedAtRef.current,
        ...(disconnecting ? { disconnecting: true } : {}),
      };
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
      ws.send(encodeMessage(1, payloadBytes));
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

      const [msgType, offset] = readVarint(data, 0);
      const payload = data.slice(offset);

      if (msgType === 2) {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(payload)) as CellUpdatePayload;
          if (parsed.clientId === clientIdRef.current) return;
          console.log('[sheets-sync] recv', { from: parsed.clientId.slice(0, 6), sheetIndex: parsed.sheetIndex, cells: parsed.cells.length, ids: parsed.cells.map(c => c.id) });
          onRemoteCellsRef?.current?.(parsed.sheetIndex, parsed.cells);
        } catch {
          // ignore malformed cell update messages
        }
        return;
      }

      if (msgType !== 1) return;

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
            cellId: parsed.cursor?.cellId ?? null,
          }];
        });

        if (isNewPeer) {
          sendAwarenessRef.current();
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
          cursor: selectedCellIdRef.current ? { cellId: selectedCellIdRef.current } : null,
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
  }, [enabled, sheetId, authToken]);

  // Heartbeat: re-announce presence every 10s so late joiners see us
  useEffect(() => {
    if (!enabled || !authToken) return;
    const id = setInterval(() => sendAwarenessRef.current(), HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, authToken]);

  // Broadcast when selected cell changes so peers see cursor movement immediately
  useEffect(() => {
    if (!enabled || !authToken) return;
    sendAwarenessRef.current();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCellId]);

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

  const broadcastCells = useCallback((sheetIndex: number, cells: CellSyncItem[]) => {
    const ws = wsRef.current;
    const wsState = ws ? ['CONNECTING','OPEN','CLOSING','CLOSED'][ws.readyState] : 'NO_WS';
    console.log('[sheets-sync] send attempt', { sheetIndex, cells: cells.length, ids: cells.map(c => c.id), wsState });
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const cellPayload: CellUpdatePayload = { clientId: clientIdRef.current, sheetIndex, cells };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(cellPayload));
    ws.send(encodeMessage(2, payloadBytes));
    console.log('[sheets-sync] sent', { sheetIndex, cells: cells.length, ids: cells.map(c => c.id) });
  }, []);

  return { remoteUsers, broadcastCells };
}
