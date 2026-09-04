/**
 * The role matrix, client side (issue #185, phase 6).
 *
 * A mirror of `src/drive/teams/roles.rs`, and only a mirror. **The server is what decides**: every
 * team route re-checks the caller's role, so this being wrong is a wrong button, not a wrong
 * permission. It exists so a Viewer is not shown a "New page" button that answers 403, which is a
 * worse way to learn what your role is than not seeing the button.
 *
 * Kept as a literal copy of the server's match rather than derived from a rank, for the reason the
 * server gives: the matrix is per-action, not a ladder. A Contributor may upload a file and may not
 * delete one, and no ordering says that.
 */

import type { TeamRole } from '@neutrino/api-drive';

export type TeamAction =
  | 'viewTeam'
  | 'createPage'
  | 'editPage'
  | 'deletePage'
  | 'uploadFile'
  | 'deleteFile'
  | 'inviteMember'
  | 'managePermissions'
  | 'manageSettings'
  | 'deleteTeam';

const MATRIX: Record<TeamAction, readonly TeamRole[]> = {
  viewTeam: ['owner', 'admin', 'editor', 'contributor', 'viewer', 'guest'],
  createPage: ['owner', 'admin', 'editor', 'contributor'],
  editPage: ['owner', 'admin', 'editor', 'contributor'],
  deletePage: ['owner', 'admin', 'editor'],
  uploadFile: ['owner', 'admin', 'editor', 'contributor'],
  deleteFile: ['owner', 'admin', 'editor'],
  inviteMember: ['owner', 'admin'],
  managePermissions: ['owner', 'admin'],
  manageSettings: ['owner', 'admin'],
  deleteTeam: ['owner'],
};

export function roleCan(role: TeamRole | undefined, action: TeamAction): boolean {
  if (!role) return false;
  return MATRIX[action].includes(role);
}

/**
 * Whether the team allows this action right now, role and archived state together.
 *
 * An archived team is read-only for everyone, whatever their role — the one exception being
 * restoring it, which is a settings change an Owner or Admin can always reach and which callers
 * check with `roleCan` directly.
 */
export function teamCan(
  team: { userRole: TeamRole; archived: boolean } | undefined,
  action: TeamAction
): boolean {
  if (!team) return false;
  if (team.archived && action !== 'viewTeam') return false;
  return roleCan(team.userRole, action);
}
