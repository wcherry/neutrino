/**
 * Team Spaces client (issue #185).
 *
 * Mirrors `src/drive/teams/api.rs`. Everything here is behind the `teamSpaces` feature flag on the
 * server, and a gated-off route answers **404** — so a caller that reaches these methods with the
 * flag off gets "not found", not "forbidden". Read the flag before rendering a team surface rather
 * than inferring it from a failed request.
 */

import { request, buildQuery } from '@neutrino/api-core';

// ── Roles ────────────────────────────────────────────────────────────────────

/**
 * The six team roles, in the same order as `teams::roles::Role`.
 *
 * Not a ladder: a Contributor may upload a file and may not delete one, which no ordering
 * expresses. The authoritative matrix is server-side; `TEAM_ROLE_LABELS` here is for rendering a
 * picker, not for deciding what someone may do.
 */
export const TEAM_ROLES = [
  'owner',
  'admin',
  'editor',
  'contributor',
  'viewer',
  'guest',
] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  contributor: 'Contributor',
  viewer: 'Viewer',
  guest: 'Guest',
};

/** What each role is for, shown beside it in the role picker. */
export const TEAM_ROLE_DESCRIPTIONS: Record<TeamRole, string> = {
  owner: 'Everything, including deleting the team.',
  admin: 'Everything except deleting the team.',
  editor: 'Create, edit and delete pages and files.',
  contributor: 'Create and edit pages and files, but not delete them.',
  viewer: 'Read everything in the team.',
  guest: 'Read-only access for someone outside the team.',
};

/**
 * Who can find a team, and how they get in.
 *
 * Never what a member may do once inside — that is `TeamRole`, and the two are independent: a
 * viewer in a private team and a viewer in an organization team have identical authority.
 *
 * - `private` — not discoverable. A non-member gets 404 on every route, as for a team that does
 *   not exist.
 * - `organization` — discoverable, and anyone signed in adds themselves.
 * - `invite_only` — discoverable, and anyone signed in asks; an owner or admin decides.
 */
export type TeamVisibility = 'private' | 'invite_only' | 'organization';

/** What the Settings picker says each visibility does. Kept beside the type so they cannot drift. */
export const TEAM_VISIBILITY_DESCRIPTIONS: Record<TeamVisibility, string> = {
  private: 'Only members can find this team. People are added by an admin.',
  organization: 'Anyone signed in can find this team and join it themselves.',
  invite_only: 'Anyone signed in can find this team and request access. An admin decides.',
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface Team {
  id: string;
  name: string;
  /** URL-stable; unchanged by a rename, so links into the team survive one. */
  slug: string;
  description: string | null;
  avatarColor: string | null;
  avatarEmoji: string | null;
  visibility: TeamVisibility;
  createdBy: string;
  /** The page the team opens on — its Home page unless it has been repointed. */
  defaultPageId: string | null;
  storageUsedBytes: number;
  /** Null means the team has no limit of its own. */
  storageLimitBytes: number | null;
  /** Archived is read-only and reversible; deleted teams are not returned at all. */
  archived: boolean;
  memberCount: number;
  /** The caller's own role. Always set — a caller with no role never sees the team. */
  userRole: TeamRole;
  createdAt: string;
  updatedAt: string;
}

export interface TeamListResponse {
  teams: Team[];
  total: number;
}

export interface CreateTeamRequest {
  name: string;
  description?: string;
  avatarColor?: string;
  avatarEmoji?: string;
  visibility?: TeamVisibility;
}

export interface UpdateTeamRequest {
  name?: string;
  description?: string | null;
  avatarColor?: string | null;
  avatarEmoji?: string | null;
  visibility?: TeamVisibility;
  defaultPageId?: string;
  archived?: boolean;
}

/**
 * A team the caller can see but is **not** in.
 *
 * Deliberately much smaller than `Team`: no storage, no default page, and above all no `userRole`,
 * because the caller has none. `Team` continues to mean "a team you are in", which is what the
 * rest of the UI assumes.
 */
export interface DiscoverableTeam {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatarColor: string | null;
  avatarEmoji: string | null;
  /** Only ever `organization` or `invite_only` — private teams are not discoverable. */
  visibility: Exclude<TeamVisibility, 'private'>;
  memberCount: number;
  /**
   * What the button should say. Decided by the server rather than derived from `visibility` here,
   * so the client cannot get the policy wrong or fall out of step with it.
   */
  joinAction: 'join' | 'request' | 'requested';
  createdAt: string;
}

export interface DiscoverableTeamListResponse {
  teams: DiscoverableTeam[];
  total: number;
}

export type JoinRequestStatus = 'pending' | 'approved' | 'declined';

export interface TeamJoinRequest {
  id: string;
  teamId: string;
  userId: string;
  email: string;
  name: string;
  message: string | null;
  status: JoinRequestStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface JoinRequestListResponse {
  requests: TeamJoinRequest[];
  total: number;
}

export interface TeamMember {
  userId: string;
  email: string;
  name: string;
  role: TeamRole;
  addedBy: string;
  createdAt: string;
}

export interface TeamMemberListResponse {
  members: TeamMember[];
  total: number;
}

export interface TeamPage {
  id: string;
  teamId: string;
  parentPageId: string | null;
  title: string;
  slug: string;
  /** Absent from list responses, which would otherwise carry every page's whole body. */
  contentMd?: string;
  icon: string | null;
  coverImage: string | null;
  sortOrder: number;
  isHome: boolean;
  published: boolean;
  createdBy: string;
  lastEditedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamPageListResponse {
  /** Flat, in sibling order. Build the tree from `parentPageId`. */
  pages: TeamPage[];
  total: number;
}

export interface CreatePageRequest {
  title: string;
  parentPageId?: string;
  contentMd?: string;
  icon?: string;
}

export interface UpdatePageRequest {
  title?: string;
  contentMd?: string;
  icon?: string | null;
  coverImage?: string | null;
  /** `null` moves the page to the top level; omit to leave it where it is. */
  parentPageId?: string | null;
  sortOrder?: number;
  published?: boolean;
  /** Names the version this save records. Ignored when the body has not changed. */
  versionLabel?: string;
}

export interface TeamPageVersion {
  id: string;
  pageId: string;
  versionNumber: number;
  title: string;
  contentMd?: string;
  label: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface TeamPageVersionListResponse {
  versions: TeamPageVersion[];
  total: number;
}

export interface TeamActivityEntry {
  id: string;
  /** Who did it, as recorded at the time — so an entry still reads correctly after they leave. */
  actor: string;
  /** A dotted verb: `team.page_created`, `team.file_added`, `team.member_role_changed`. */
  action: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface TeamActivityResponse {
  entries: TeamActivityEntry[];
  total: number;
}

export interface TeamFile {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  folderId: string | null;
  /** Who uploaded it. Not who may read it — the team's membership decides that. */
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamLibraryResponse {
  folders: TeamFolder[];
  files: TeamFile[];
  storageUsedBytes: number;
}

// ── Client ───────────────────────────────────────────────────────────────────

const base = '/api/v1/drive/teams';

export const teamsApi = {
  async list(): Promise<TeamListResponse> {
    return request<TeamListResponse>(base);
  },

  async get(teamId: string): Promise<Team> {
    return request<Team>(`${base}/${encodeURIComponent(teamId)}`);
  },

  /** Creates the team, makes the caller its Owner, and gives it a Home page. */
  async create(body: CreateTeamRequest): Promise<Team> {
    return request<Team>(base, { method: 'POST', body: JSON.stringify(body) });
  },

  async update(teamId: string, body: UpdateTeamRequest): Promise<Team> {
    return request<Team>(`${base}/${encodeURIComponent(teamId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  /** Soft delete. Owner only. */
  async remove(teamId: string): Promise<void> {
    await request<void>(`${base}/${encodeURIComponent(teamId)}`, { method: 'DELETE' });
  },

  // Discovery and joining

  /**
   * Teams the caller could join but is not in.
   *
   * The only team read that does not need membership. Private teams never appear in it.
   */
  async listDiscoverable(): Promise<DiscoverableTeamListResponse> {
    return request<DiscoverableTeamListResponse>(`${base}/discoverable`);
  },

  /** Join an `organization` team. Refused with 403 on an `invite_only` one. */
  async join(teamId: string): Promise<TeamMember> {
    return request<TeamMember>(`${base}/${encodeURIComponent(teamId)}/join`, { method: 'POST' });
  },

  /** Ask to join an `invite_only` team. */
  async requestAccess(teamId: string, message?: string): Promise<TeamJoinRequest> {
    return request<TeamJoinRequest>(`${base}/${encodeURIComponent(teamId)}/join-requests`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  },

  /** The team's join requests — pending unless another status is asked for. Admins and owners. */
  async listJoinRequests(
    teamId: string,
    status?: JoinRequestStatus
  ): Promise<JoinRequestListResponse> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return request<JoinRequestListResponse>(
      `${base}/${encodeURIComponent(teamId)}/join-requests${q}`
    );
  },

  /** Approve a request, admitting the requester as a Viewer unless a role is named. */
  async approveJoinRequest(
    teamId: string,
    requestId: string,
    role?: TeamRole
  ): Promise<TeamMember> {
    return request<TeamMember>(
      `${base}/${encodeURIComponent(teamId)}/join-requests/${encodeURIComponent(
        requestId
      )}/approve`,
      { method: 'POST', body: JSON.stringify({ role }) }
    );
  },

  async declineJoinRequest(teamId: string, requestId: string): Promise<void> {
    await request<void>(
      `${base}/${encodeURIComponent(teamId)}/join-requests/${encodeURIComponent(
        requestId
      )}/decline`,
      { method: 'POST' }
    );
  },

  // Members

  async listMembers(teamId: string): Promise<TeamMemberListResponse> {
    return request<TeamMemberListResponse>(`${base}/${encodeURIComponent(teamId)}/members`);
  },

  async addMember(teamId: string, email: string, role: TeamRole): Promise<TeamMember> {
    return request<TeamMember>(`${base}/${encodeURIComponent(teamId)}/members`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    });
  },

  async updateMember(teamId: string, userId: string, role: TeamRole): Promise<TeamMember> {
    return request<TeamMember>(
      `${base}/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
      { method: 'PATCH', body: JSON.stringify({ role }) }
    );
  },

  /** Removes someone, or — passing your own id — leaves the team. */
  async removeMember(teamId: string, userId: string): Promise<void> {
    await request<void>(
      `${base}/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    );
  },

  // Pages

  /** The whole tree, or the pages matching `q` on title and body. */
  async listPages(teamId: string, q?: string): Promise<TeamPageListResponse> {
    const query = q ? buildQuery({ q }) : '';
    return request<TeamPageListResponse>(
      `${base}/${encodeURIComponent(teamId)}/pages${query}`
    );
  },

  async getPage(teamId: string, pageId: string): Promise<TeamPage> {
    return request<TeamPage>(
      `${base}/${encodeURIComponent(teamId)}/pages/${encodeURIComponent(pageId)}`
    );
  },

  async createPage(teamId: string, body: CreatePageRequest): Promise<TeamPage> {
    return request<TeamPage>(`${base}/${encodeURIComponent(teamId)}/pages`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async updatePage(teamId: string, pageId: string, body: UpdatePageRequest): Promise<TeamPage> {
    return request<TeamPage>(
      `${base}/${encodeURIComponent(teamId)}/pages/${encodeURIComponent(pageId)}`,
      { method: 'PATCH', body: JSON.stringify(body) }
    );
  },

  /** Soft-deletes the page and its subpages. Refused for the Home page. */
  async deletePage(teamId: string, pageId: string): Promise<void> {
    await request<void>(
      `${base}/${encodeURIComponent(teamId)}/pages/${encodeURIComponent(pageId)}`,
      { method: 'DELETE' }
    );
  },

  async duplicatePage(teamId: string, pageId: string): Promise<TeamPage> {
    return request<TeamPage>(
      `${base}/${encodeURIComponent(teamId)}/pages/${encodeURIComponent(pageId)}/duplicate`,
      { method: 'POST' }
    );
  },

  async listPageVersions(teamId: string, pageId: string): Promise<TeamPageVersionListResponse> {
    return request<TeamPageVersionListResponse>(
      `${base}/${encodeURIComponent(teamId)}/pages/${encodeURIComponent(pageId)}/versions`
    );
  },

  async getPageVersion(
    teamId: string,
    pageId: string,
    versionId: string
  ): Promise<TeamPageVersion> {
    return request<TeamPageVersion>(
      `${base}/${encodeURIComponent(teamId)}/pages/${encodeURIComponent(pageId)}` +
        `/versions/${encodeURIComponent(versionId)}`
    );
  },

  /** Puts an old version back, recording the current one first. */
  async restorePageVersion(
    teamId: string,
    pageId: string,
    versionId: string
  ): Promise<TeamPage> {
    return request<TeamPage>(
      `${base}/${encodeURIComponent(teamId)}/pages/${encodeURIComponent(pageId)}` +
        `/versions/${encodeURIComponent(versionId)}/restore`,
      { method: 'POST' }
    );
  },

  /**
   * Recent activity in the team.
   *
   * Behind `teamSpaces` like every other team route. The entries were written on each team write
   * since the flag went on, so the feed has a history from the first team created.
   */
  async listActivity(teamId: string): Promise<TeamActivityResponse> {
    return request<TeamActivityResponse>(`${base}/${encodeURIComponent(teamId)}/activity`);
  },

  // File library

  async listLibrary(teamId: string, folderId?: string): Promise<TeamLibraryResponse> {
    const query = folderId ? buildQuery({ folderId }) : '';
    return request<TeamLibraryResponse>(
      `${base}/${encodeURIComponent(teamId)}/library${query}`
    );
  },

  async createLibraryFolder(
    teamId: string,
    name: string,
    parentId?: string
  ): Promise<TeamFolder> {
    return request<TeamFolder>(`${base}/${encodeURIComponent(teamId)}/library/folders`, {
      method: 'POST',
      body: JSON.stringify({ name, parentId }),
    });
  },

  /**
   * Move a file the caller has already uploaded into the team's library.
   *
   * Deliberately the second half of a two-step upload: the bytes go through the ordinary
   * `storageApi.uploadFile` (or `uploadEncryptedFile`), which handles encryption, the thumbnail
   * and the uploader's own quota, and this claims the result for the team. Team files are
   * therefore the same rows as everything else, with the same versions, trash and encryption.
   */
  async claimFile(teamId: string, fileId: string, folderId?: string): Promise<TeamFile> {
    return request<TeamFile>(`${base}/${encodeURIComponent(teamId)}/library/files`, {
      method: 'POST',
      body: JSON.stringify({ fileId, folderId }),
    });
  },

  async renameLibraryFile(teamId: string, fileId: string, name: string): Promise<TeamFile> {
    return request<TeamFile>(
      `${base}/${encodeURIComponent(teamId)}/library/files/${encodeURIComponent(fileId)}`,
      { method: 'PATCH', body: JSON.stringify({ name }) }
    );
  },

  async trashLibraryFile(teamId: string, fileId: string): Promise<void> {
    await request<void>(
      `${base}/${encodeURIComponent(teamId)}/library/files/${encodeURIComponent(fileId)}`,
      { method: 'DELETE' }
    );
  },
};

// ── Tree helpers ─────────────────────────────────────────────────────────────

export interface TeamPageNode extends TeamPage {
  children: TeamPageNode[];
  depth: number;
}

/**
 * Assemble the flat page list into the sidebar's tree.
 *
 * A page whose parent is not in the list is treated as a root rather than dropped — that happens
 * while a search is filtered, where a child can match and its parent not, and dropping it would
 * hide the very result the search found.
 */
export function buildPageTree(pages: TeamPage[]): TeamPageNode[] {
  const nodes = new Map<string, TeamPageNode>();
  for (const page of pages) {
    nodes.set(page.id, { ...page, children: [], depth: 0 });
  }

  const roots: TeamPageNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentPageId ? nodes.get(node.parentPageId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  // Home first, then the manual order, then title — the same order the server lists siblings in,
  // with Home pinned because it is the page the team opens on.
  const sort = (list: TeamPageNode[], depth: number) => {
    list.sort((a, b) => {
      if (a.isHome !== b.isHome) return a.isHome ? -1 : 1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.title.localeCompare(b.title);
    });
    for (const node of list) {
      node.depth = depth;
      sort(node.children, depth + 1);
    }
  };
  sort(roots, 0);
  return roots;
}

/** The tree flattened back to a list, parents before children — what the sidebar renders. */
export function flattenPageTree(nodes: TeamPageNode[]): TeamPageNode[] {
  return nodes.flatMap((node) => [node, ...flattenPageTree(node.children)]);
}
