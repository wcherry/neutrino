import type { TopbarNotification } from './Topbar';

/** What a notification says, in a sentence — shared by the classic top bar and the new one. */
export function notificationLabel(n: TopbarNotification): string {
  const payload = n.payload as Record<string, string>;
  const type = payload.resourceType === 'folder' ? 'folder' : 'file';
  const name = payload.resourceName;

  if (n.eventType === 'file_access_revoked' || n.eventType === 'folder_access_revoked') {
    if (name) {
      return `Your access to the ${type} "${name}" has been revoked`;
    }
    return `Your access to a ${type} has been revoked`;
  }

  const role = payload.role ?? 'access';
  if (name) {
    return `You were granted ${role} access to the ${type} "${name}"`;
  }
  return `You were granted ${role} access to a ${type}`;
}

export function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
