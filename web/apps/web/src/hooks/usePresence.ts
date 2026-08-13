'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import * as Y from 'yjs';
import {
  readVarint,
  readVarBytes,
  encodeSyncStep1,
  encodeUpdate,
  encodeAwarenessMessage,
  colorFromName,
  HEARTBEAT_INTERVAL_MS,
  STALE_TIMEOUT_MS,
  STALE_CHECK_INTERVAL_MS,
} from '@neutrino/collab-core';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RemoteUser {
  clientId: string;
  name: string;
  color: string;
  cursor: { anchor: number; head: number } | null;
  /** Epoch ms when this peer connected; used for writer election. */
  joinedAt?: number;
}

export interface PresenceState {
  remoteUsers: RemoteUser[];
  isConnected: boolean;
  /** True once the initial SyncStep2 from the server has been applied. */
  syncReady: boolean;
  /**
   * True when this client is the elected writer — i.e. it has the earliest
   * joinedAt among all participants. Always true when no peers are present.
   * Only the writer should autosave or create versions.
   */
  isLocalWriter: boolean;
}

interface AwarenessPayload {
  clientId: string;
  user: { name: string; color: string };
  cursor: { anchor: number; head: number } | null;
  disconnecting?: boolean;
  /** Epoch ms when this client connected; used for writer election. */
  joinedAt?: number;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

interface UsePresenceOptions {
  docId: string;
  userName: string;
  authToken: string | null;
  editor: Editor | null;
  enabled: boolean;
  /** Yjs document to sync with the backend collab server. */
  ydoc: Y.Doc;
}

export function usePresence({
  docId,
  userName,
  authToken,
  editor,
  enabled,
  ydoc,
}: UsePresenceOptions): PresenceState {
  const [remoteUsers, setRemoteUsers] = useState<RemoteUser[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [syncReady, setSyncReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
  const localJoinedAtRef = useRef<number>(Date.now());
  const lastSeenRef = useRef<Map<string, number>>(new Map());
  const myColor = colorFromName(userName);

  // Whether we should broadcast the next Y.Doc update (guards against echo)
  const shouldBroadcastRef = useRef(true);

  // Content sync is suppressed while nobody else is in the room — see
  // flushPendingUpdates. Presence (awareness) keeps running regardless; it is
  // what tells us a peer has arrived.
  const hasPeersRef = useRef(false);
  const pendingUpdatesRef = useRef(false);
  const seedSentRef = useRef(false);

  /**
   * Push the whole local Y.Doc to the server.
   *
   * Local edits are not broadcast while this client is alone in the room:
   * there is nobody to receive them, and the file itself is persisted by the
   * editor's own encrypted autosave, not by this socket. The server does keep
   * the room's Y.Doc — it is what the next session is seeded from, and
   * DocEditor prefers it over the stored file when it is non-empty — so the
   * held-back edits have to land before they can matter: when a peer arrives,
   * and when this session ends. Sending full state rather than the individual
   * updates is idempotent on the server, so flushing twice is harmless.
   */
  const flushPendingUpdates = useCallback(() => {
    if (!pendingUpdatesRef.current) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    pendingUpdatesRef.current = false;
    ws.send(encodeUpdate(Y.encodeStateAsUpdate(ydoc)));
  }, [ydoc]);

  const sendAwareness = useCallback(
    (cursor: { anchor: number; head: number } | null, disconnecting = false) => {
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

  // Connect WebSocket — handles both Yjs doc sync and awareness
  useEffect(() => {
    if (!enabled || !docId || !authToken) return;

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/v1/docs/${docId}/ws?token=${encodeURIComponent(authToken)}`;
    console.log('[collab] connecting to WS for doc', docId);
    seedSentRef.current = false;
    pendingUpdatesRef.current = false;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[collab] WS connected');
      setIsConnected(true);

      // ── Yjs: send SyncStep1 with our current state vector ──
      const sv = Y.encodeStateVector(ydoc);
      console.log('[collab] sending SyncStep1, sv size:', sv.length, 'bytes');
      ws.send(encodeSyncStep1(sv));

      // ── Awareness: announce ourselves ──
      sendAwareness(null);
    };

    ws.onclose = (e) => {
      console.log('[collab] WS closed, code:', e.code, 'reason:', e.reason || '(none)');
      setIsConnected(false);
      setSyncReady(false);
      setRemoteUsers([]);
      lastSeenRef.current.clear();
    };

    ws.onerror = (e) => {
      console.error('[collab] WS error', e);
      setIsConnected(false);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const data = new Uint8Array(event.data);
      if (data.length === 0) return;

      const [msgType, offset] = readVarint(data, 0);

      if (msgType === 0) {
        // ── Yjs sync message ───────────────────────────────────────
        const [subType, offset2] = readVarint(data, offset);
        const parsed = readVarBytes(data, offset2);
        if (!parsed) {
          console.warn('[collab] malformed sync message, sub:', subType, 'data len:', data.length);
          return;
        }
        const [updateBytes] = parsed;

        if (subType === 1) {
          // SyncStep2 — full state from server
          console.log('[collab] received SyncStep2, update size:', updateBytes.length, 'bytes');
          shouldBroadcastRef.current = false;
          try {
            Y.applyUpdate(ydoc, updateBytes);
          } catch (err) {
            console.error('[collab] failed to apply SyncStep2 update:', err);
          }
          shouldBroadcastRef.current = true;
          setSyncReady(true);
          console.log('[collab] SyncStep2 applied — sync ready');
        } else if (subType === 2) {
          // Update — incremental change from a peer
          console.log('[collab] received Update from peer, size:', updateBytes.length, 'bytes');
          shouldBroadcastRef.current = false;
          try {
            Y.applyUpdate(ydoc, updateBytes);
          } catch (err) {
            console.error('[collab] failed to apply peer Update:', err);
          }
          shouldBroadcastRef.current = true;
        } else {
          console.warn('[collab] unexpected sync sub-type:', subType);
        }
      } else if (msgType === 1) {
        // ── Awareness / presence message ───────────────────────────
        const payload = data.slice(offset);
        try {
          const parsed = JSON.parse(new TextDecoder().decode(payload)) as AwarenessPayload;
          if (parsed.clientId === clientIdRef.current) return;

          if (parsed.disconnecting) {
            console.log('[collab] peer disconnected:', parsed.user.name);
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
              cursor: parsed.cursor,
              joinedAt: parsed.joinedAt,
            }];
          });

          // Immediately announce ourselves so the new peer sees us without
          // waiting up to 10 seconds for the next heartbeat.
          if (isNewPeer) {
            console.log('[collab] new peer detected:', parsed.user.name, '— sending immediate awareness');
            sendAwarenessRef.current(null);
          }
        } catch {
          // Ignore malformed awareness messages
        }
      } else {
        console.warn('[collab] unknown message type:', msgType);
      }
    };

    // ── Observe Y.Doc and send Updates when local edits happen ──
    const onYDocUpdate = (update: Uint8Array, origin: unknown) => {
      // Only broadcast updates that originated locally (not from applying remote updates)
      if (!shouldBroadcastRef.current) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      // Alone in the room — hold this back until someone else shows up (or the
      // session ends). The exception is the first update of the session, which
      // is the editor seeding the Y.Doc from the stored file: the server needs
      // that one, or a client that connects later finds the room empty and
      // seeds a second, divergent copy of the same content.
      if (!hasPeersRef.current && seedSentRef.current) {
        pendingUpdatesRef.current = true;
        return;
      }
      seedSentRef.current = true;
      console.log('[collab] local Y.Doc update, sending to server, size:', update.length, 'bytes');
      ws.send(encodeUpdate(update));
    };
    ydoc.on('update', onYDocUpdate);

    return () => {
      ydoc.off('update', onYDocUpdate);
      flushPendingUpdates();

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
      setIsConnected(false);
      setSyncReady(false);
      setRemoteUsers([]);
      lastSeenRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, docId, authToken]);

  // Heartbeat: re-announce presence every 10s so late joiners see us
  useEffect(() => {
    if (!enabled || !authToken) return;
    const id = setInterval(() => {
      const sel = editor?.state.selection;
      sendAwareness(sel ? { anchor: sel.anchor, head: sel.head } : null);
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, authToken, editor, sendAwareness]);

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

  // Track whether anyone else is here, and hand over everything typed while
  // alone the moment someone joins.
  useEffect(() => {
    const hadPeers = hasPeersRef.current;
    hasPeersRef.current = remoteUsers.length > 0;
    if (!hadPeers && hasPeersRef.current) flushPendingUpdates();
  }, [remoteUsers, flushPendingUpdates]);

  // Announce departure on tab close, flushing held-back edits first. `pagehide`
  // covers what `beforeunload` misses (mobile Safari, bfcache); a tab merely
  // going hidden flushes too, so a session that is killed rather than closed
  // still leaves the server's copy of the room current.
  useEffect(() => {
    const handleUnload = () => {
      flushPendingUpdates();
      sendAwarenessRef.current(null, true);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flushPendingUpdates();
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [flushPendingUpdates]);

  // Broadcast cursor position on selection change
  useEffect(() => {
    if (!enabled || !editor) return;
    const onSelectionUpdate = () => {
      const { anchor, head } = editor.state.selection;
      sendAwareness({ anchor, head });
    };
    editor.on('selectionUpdate', onSelectionUpdate);
    return () => { editor.off('selectionUpdate', onSelectionUpdate); };
  }, [enabled, editor, sendAwareness]);

  // Writer election: the participant with the earliest joinedAt owns writes.
  // Tiebreak by clientId (lexicographic) so exactly one client wins.
  // Unknown joinedAt (legacy peer) is treated as 0 — they win by default to
  // avoid two clients writing simultaneously in mixed-version sessions.
  const isLocalWriter = remoteUsers.every(u => {
    const remoteJoinedAt = u.joinedAt ?? 0;
    if (localJoinedAtRef.current === remoteJoinedAt) {
      return clientIdRef.current < u.clientId;
    }
    return localJoinedAtRef.current < remoteJoinedAt;
  });

  return { remoteUsers, isConnected, syncReady, isLocalWriter };
}
