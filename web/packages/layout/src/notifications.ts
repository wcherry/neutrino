import type { TopbarNotification } from './Topbar';

/** What a notification says, in a sentence — shared by the classic top bar and the new one. */
export function notificationLabel(n: TopbarNotification): string {
  const payload = n.payload as Record<string, string>;
  const type = payload.resourceType === 'folder' ? 'folder' : 'file';
  const name = payload.resourceName;

  // Team key requests (a member who joined after a file was added asks for its key).
  const file = name ? `"${name}"` : 'a file';
  const team = payload.teamName ? ` in ${payload.teamName}` : '';
  if (n.eventType === 'team_key_requested') {
    return `Someone${team} asked for the key to ${file}`;
  }
  if (n.eventType === 'team_key_approved') {
    return `You can now open ${file}${team}`;
  }
  if (n.eventType === 'team_key_denied') {
    const reason = payload.reason ? `: ${payload.reason}` : '';
    return `Your request for the key to ${file}${team} was denied${reason}`;
  }

  // Access requests: asked of an owner, then answered to the requester.
  const thing = name ? `the ${type} "${name}"` : `a ${type}`;
  if (n.eventType === 'access_requested') {
    const who = payload.requesterName || 'Someone';
    return `${who} asked for ${payload.role ?? 'viewer'} access to ${thing}`;
  }
  if (n.eventType === 'access_request_approved') {
    return `Your request for ${thing} was approved`;
  }
  if (n.eventType === 'access_request_denied') {
    return `Your request for ${thing} was declined`;
  }

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
