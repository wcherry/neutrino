/**
 * What the inbox says about access requests: asked of an owner, then answered to the requester.
 */
import { describe, it, expect } from 'vitest';
import { notificationLabel } from '../notifications';
import type { TopbarNotification } from '../Topbar';

function n(eventType: string, payload: Record<string, string>): TopbarNotification {
  return { id: 'n1', eventType, payload, isRead: false, createdAt: '2026-11-03T10:00:00Z' } as TopbarNotification;
}

describe('notificationLabel', () => {
  it('names who asked, for what and how much', () => {
    expect(
      notificationLabel(
        n('access_requested', { resourceType: 'file', resourceName: 'Budget', requesterName: 'Bob', role: 'editor' }),
      ),
    ).toBe('Bob asked for editor access to the file "Budget"');
    expect(notificationLabel(n('access_requested', { resourceType: 'folder' }))).toBe(
      'Someone asked for viewer access to a folder',
    );
  });

  it('tells the requester how it was answered', () => {
    const payload = { resourceType: 'file', resourceName: 'Budget' };
    expect(notificationLabel(n('access_request_approved', payload))).toBe(
      'Your request for the file "Budget" was approved',
    );
    expect(notificationLabel(n('access_request_denied', payload))).toBe(
      'Your request for the file "Budget" was declined',
    );
  });
});
