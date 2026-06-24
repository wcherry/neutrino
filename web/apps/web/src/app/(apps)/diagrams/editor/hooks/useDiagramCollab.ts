'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as Y from 'yjs';
import type { DiagramDocument } from '../../types';
import {
  readVarint,
  readVarBytes,
  encodeSyncStep1,
  encodeUpdate,
  encodeAwarenessMessage,
} from '@neutrino/collab-core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RemoteUser {
  clientId: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
}

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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseDiagramCollabOptions {
  diagramId: string;
  userName: string;
  authToken: string | null;
  enabled: boolean;
  /** Called when a remote client broadcasts a document update. */
  onRemoteDocument?: (doc: DiagramDocument) => void;
}

export interface DiagramCollabState {
  remoteUsers: RemoteUser[];
  isConnected: boolean;
  sendCursor: (pos: { x: number; y: number } | null) => void;
  /** Broadcast the current local diagram document to all connected peers. */
  broadcastDocument: (doc: DiagramDocument) => void;
}

export function useDiagramCollab({
  diagramId,
  userName,
  authToken,
  enabled,
  onRemoteDocument,
}: UseDiagramCollabOptions): DiagramCollabState {
  const [remoteUsers, setRemoteUsers] = useState<RemoteUser[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(
    Math.random().toString(36).slice(2) + Date.now().toString(36),
  );
  const myColor = hashColor(clientIdRef.current);

  // Yjs document — stores the diagram JSON in a Y.Text field named "content"
  const ydocRef = useRef<Y.Doc>(new Y.Doc());

  // Guards against echoing remote updates back to the server
  const isApplyingRemoteRef = useRef(false);

  // Stable ref to onRemoteDocument so the WS effect doesn't need it as a dep
  const onRemoteDocumentRef = useRef(onRemoteDocument);
  useEffect(() => { onRemoteDocumentRef.current = onRemoteDocument; }, [onRemoteDocument]);

  const sendCursor = useCallback(
    (pos: { x: number; y: number } | null) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const payload = {
        clientId: clientIdRef.current,
        user: { name: userName, color: myColor },
        cursor: pos,
      };
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
      const msg = encodeAwarenessMessage(payloadBytes);
      ws.send(msg);
    },
    [userName, myColor],
  );

  const broadcastDocument = useCallback((doc: DiagramDocument) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Write the new JSON into the Y.Text — Yjs computes an incremental update
    const ydoc = ydocRef.current;
    const ytext = ydoc.getText('content');
    const json = JSON.stringify(doc);
    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, json);
    });
    // The ydoc 'update' observer (registered in the WS effect) sends the update
  }, []);

  useEffect(() => {
    if (!enabled || !diagramId || !authToken) return;

    const ydoc = ydocRef.current;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}/api/v1/diagrams/${diagramId}/ws?token=${encodeURIComponent(authToken)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      // Send SyncStep1 so the server knows what state we have
      const sv = Y.encodeStateVector(ydoc);
      ws.send(encodeSyncStep1(sv));
      sendCursor(null);
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
      if (data.length === 0) return;

      const [msgType, offset] = readVarint(data, 0);

      if (msgType === 0) {
        // Yjs sync message
        const [subType, offset2] = readVarint(data, offset);
        const parsed = readVarBytes(data, offset2);
        if (!parsed) return;
        const [updateBytes] = parsed;

        if (subType === 1 || subType === 2) {
          // SyncStep2 (full state) or Update (incremental)
          isApplyingRemoteRef.current = true;
          try {
            Y.applyUpdate(ydoc, updateBytes);
            const json = ydoc.getText('content').toString();
            if (json) {
              try {
                const doc = JSON.parse(json) as DiagramDocument;
                onRemoteDocumentRef.current?.(doc);
              } catch {
                // Ignore malformed JSON
              }
            }
          } finally {
            isApplyingRemoteRef.current = false;
          }
        }
      } else if (msgType === 1) {
        // Awareness / presence message
        const payload = data.slice(offset);
        try {
          const parsed = JSON.parse(new TextDecoder().decode(payload)) as {
            clientId: string;
            user: { name: string; color: string };
            cursor: { x: number; y: number } | null;
          };
          if (parsed.clientId === clientIdRef.current) return;

          setRemoteUsers((prev) => {
            const filtered = prev.filter((u) => u.clientId !== parsed.clientId);
            const updated: RemoteUser = {
              clientId: parsed.clientId,
              name: parsed.user.name,
              color: parsed.user.color || hashColor(parsed.clientId),
              cursor: parsed.cursor,
            };
            return [...filtered, updated];
          });
        } catch {
          // Ignore malformed awareness messages
        }
      }
    };

    // Observe local Y.Doc changes and send them to the server
    const onYDocUpdate = (update: Uint8Array) => {
      if (isApplyingRemoteRef.current) return;
      const currentWs = wsRef.current;
      if (!currentWs || currentWs.readyState !== WebSocket.OPEN) return;
      currentWs.send(encodeUpdate(update));
    };
    ydoc.on('update', onYDocUpdate);

    return () => {
      ydoc.off('update', onYDocUpdate);
      ws.close();
      wsRef.current = null;
      setIsConnected(false);
      setRemoteUsers([]);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, diagramId, authToken]);

  useEffect(() => {
    return () => {
      sendCursor(null);
    };
  }, [sendCursor]);

  return { remoteUsers, isConnected, sendCursor, broadcastDocument };
}
