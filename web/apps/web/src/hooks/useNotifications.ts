'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { notificationsApi, getNotificationsWsUrl } from '@neutrino/api-drive';
import type { NotificationItem } from '@neutrino/api-drive';
import { refreshTokensOnce } from '@neutrino/api-core';

const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 60000;

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

export function useNotifications() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const attemptRef = useRef(0);

  const fetchInitial = useCallback(async () => {
    try {
      const result = await notificationsApi.list(1, 50);
      if (!mountedRef.current) return;
      setNotifications(result.notifications);
      setUnreadCount(result.unreadCount);
    } catch {
      // silently ignore fetch errors on initial load
    }
  }, []);

  const connect = useCallback(async () => {
    if (!mountedRef.current) return;

    // WebSockets cannot set Authorization headers, so the token is embedded in
    // the query string. Refresh it proactively if it is expired or close to
    // expiry before building the URL.
    if (isTokenExpired(getStoredToken())) {
      const refreshed = await refreshTokensOnce();
      // If refresh fails the HTTP auth flow (via fetchInitial or another API
      // call) will call clearAuthAndRedirect(). Stop retrying here to avoid
      // spamming the backend with 401 WS requests.
      if (!refreshed || isTokenExpired(getStoredToken())) return;
    }

    if (!mountedRef.current) return;

    const url = getNotificationsWsUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      attemptRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const notification = JSON.parse(event.data as string) as NotificationItem;
        setNotifications((prev) => [notification, ...prev]);
        if (!notification.isRead) {
          setUnreadCount((c) => c + 1);
        }
        if (
          notification.eventType === 'file_access_revoked' ||
          notification.eventType === 'folder_access_revoked'
        ) {
          const p = notification.payload as Record<string, string>;
          window.dispatchEvent(
            new CustomEvent('neutrino:access-revoked', {
              detail: {
                resourceId: p.resourceId,
                resourceType: p.resourceType,
                resourceName: p.resourceName,
              },
            }),
          );
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attemptRef.current, RECONNECT_MAX_MS);
      attemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) void connect();
      }, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchInitial();
    void connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [fetchInitial, connect]);

  const markRead = useCallback(async (id: string) => {
    await notificationsApi.markRead(id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    await notificationsApi.markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
  }, []);

  return { notifications, unreadCount, markRead, markAllRead };
}
