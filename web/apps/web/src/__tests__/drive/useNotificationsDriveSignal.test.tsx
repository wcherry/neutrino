import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { DRIVE_CHANGED_EVENT, DRIVE_CHANGED_TYPE } from '@/lib/driveLiveUpdates';

// ---------------------------------------------------------------------------
// useNotifications — the drive-change signal riding the notification socket.
//
// One socket carries two kinds of message, so the failures here are the quiet ones: a signal
// treated as an inbox record shows the user a notification that does not exist, and an echo not
// recognised as our own doubles every listing read during a bulk upload.
// ---------------------------------------------------------------------------

const OUR_CLIENT_ID = 'this-tab';

vi.mock('@neutrino/api-drive', () => ({
  notificationsApi: {
    list: vi.fn().mockResolvedValue({ notifications: [], unreadCount: 0, total: 0 }),
    markRead: vi.fn().mockResolvedValue(undefined),
    markAllRead: vi.fn().mockResolvedValue(undefined),
  },
  getNotificationsWsUrl: () => 'ws://localhost/api/v1/drive/notifications/ws?token=t',
}));

vi.mock('@neutrino/api-core', () => ({
  refreshTokensOnce: vi.fn().mockResolvedValue(true),
  getClientId: () => OUR_CLIENT_ID,
}));

/** A socket that never connects on its own, so each test drives it explicitly. */
class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(public url: string) {
    FakeWebSocket.last = this;
  }

  open() {
    this.onopen?.();
  }

  receive(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

/** A token whose `exp` is far enough out that the hook connects without refreshing first. */
function unexpiredToken(): string {
  const payload = { sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 };
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

async function mountHook() {
  const { useNotifications } = await import('@/hooks/useNotifications');
  const rendered = renderHook(() => useNotifications());
  await waitFor(() => expect(FakeWebSocket.last).not.toBeNull());
  const socket = FakeWebSocket.last!;
  await act(async () => {
    socket.open();
  });
  return { ...rendered, socket };
}

const inboxRecord = {
  id: 'n1',
  recipientId: 'user-1',
  eventType: 'file_shared',
  payload: { resourceId: 'f1' },
  isRead: false,
  createdAt: '2026-09-12 10:00:00',
};

describe('useNotifications — drive change signals', () => {
  let driveChanges: number;
  let countDriveChange: () => void;

  beforeEach(() => {
    FakeWebSocket.last = null;
    localStorage.setItem('access_token', unexpiredToken());
    vi.stubGlobal('WebSocket', FakeWebSocket);

    driveChanges = 0;
    countDriveChange = () => {
      driveChanges += 1;
    };
    window.addEventListener(DRIVE_CHANGED_EVENT, countDriveChange);
  });

  afterEach(() => {
    window.removeEventListener(DRIVE_CHANGED_EVENT, countDriveChange);
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('announces a change made by another client', async () => {
    const { socket } = await mountHook();

    await act(async () => {
      socket.receive({ type: DRIVE_CHANGED_TYPE, originClientId: 'a-phone' });
    });

    expect(driveChanges).toBe(1);
  });

  it('announces a change the server attributed to nobody', async () => {
    // Native clients send no id, and the server also reports no origin for a batch it coalesced
    // across clients. Both must be treated as somebody else's change.
    const { socket } = await mountHook();

    await act(async () => {
      socket.receive({ type: DRIVE_CHANGED_TYPE, originClientId: null });
    });

    expect(driveChanges).toBe(1);
  });

  it('ignores the echo of a change this tab made itself', async () => {
    const { socket } = await mountHook();

    await act(async () => {
      socket.receive({ type: DRIVE_CHANGED_TYPE, originClientId: OUR_CLIENT_ID });
    });

    expect(driveChanges).toBe(0);
  });

  it('keeps a signal out of the notification inbox', async () => {
    const { result, socket } = await mountHook();

    await act(async () => {
      socket.receive({ type: DRIVE_CHANGED_TYPE, originClientId: 'a-phone' });
    });

    expect(result.current.notifications).toHaveLength(0);
    expect(result.current.unreadCount).toBe(0);
  });

  it('still delivers an ordinary notification to the inbox', async () => {
    const { result, socket } = await mountHook();

    await act(async () => {
      socket.receive(inboxRecord);
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.unreadCount).toBe(1);
    expect(driveChanges).toBe(0);
  });

  it('reports the socket as connected, and as disconnected when it drops', async () => {
    const { result, socket } = await mountHook();
    expect(result.current.connected).toBe(true);

    await act(async () => {
      socket.onclose?.();
    });

    expect(result.current.connected).toBe(false);
  });

  it('survives a malformed message without dropping the socket', async () => {
    const { result, socket } = await mountHook();

    await act(async () => {
      socket.onmessage?.({ data: 'not json' });
    });

    expect(result.current.connected).toBe(true);
    expect(result.current.notifications).toHaveLength(0);
    expect(driveChanges).toBe(0);
  });
});
