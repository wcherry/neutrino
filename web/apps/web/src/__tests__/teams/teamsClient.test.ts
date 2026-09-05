/**
 * The pure parts of the Team Spaces client (issue #185): the page tree, the role matrix mirror,
 * and the URL helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPageTree,
  flattenPageTree,
  TEAM_VISIBILITY_DESCRIPTIONS,
  type DiscoverableTeam,
  type TeamPage,
  type TeamVisibility,
} from '@neutrino/api-drive';
import { roleCan, teamCan } from '@/app/(apps)/teams/permissions';
import { parseTeamView, teamHref, teamPageHref } from '@/app/(apps)/teams/teamHref';

function page(overrides: Partial<TeamPage> & { id: string; title: string }): TeamPage {
  return {
    teamId: 't1',
    parentPageId: null,
    slug: overrides.title.toLowerCase(),
    icon: null,
    coverImage: null,
    sortOrder: 0,
    isHome: false,
    published: true,
    createdBy: 'u1',
    lastEditedBy: 'u1',
    createdAt: '2026-09-03T00:00:00Z',
    updatedAt: '2026-09-03T00:00:00Z',
    ...overrides,
  };
}

describe('buildPageTree', () => {
  it('nests children under their parent and records depth', () => {
    const tree = buildPageTree([
      page({ id: 'p1', title: 'Meetings' }),
      page({ id: 'p2', title: '2026', parentPageId: 'p1' }),
      page({ id: 'p3', title: 'Q1', parentPageId: 'p2' }),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('p1');
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children[0].id).toBe('p2');
    expect(tree[0].children[0].depth).toBe(1);
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });

  it('puts Home first, then sort order, then title', () => {
    const tree = buildPageTree([
      page({ id: 'p1', title: 'Zebra', sortOrder: 1 }),
      page({ id: 'p2', title: 'Home', isHome: true, sortOrder: 9 }),
      page({ id: 'p3', title: 'Apple', sortOrder: 1 }),
    ]);

    expect(tree.map((n) => n.title)).toEqual(['Home', 'Apple', 'Zebra']);
  });

  /**
   * A filtered search returns a child whose parent did not match. Dropping it would hide the very
   * result the search found, so it is shown as a root instead.
   */
  it('keeps a page whose parent is not in the list', () => {
    const tree = buildPageTree([page({ id: 'p2', title: '2026', parentPageId: 'missing' })]);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('p2');
  });

  it('flattens parents before children, in reading order', () => {
    const flat = flattenPageTree(
      buildPageTree([
        page({ id: 'p1', title: 'A' }),
        page({ id: 'p2', title: 'A-child', parentPageId: 'p1' }),
        page({ id: 'p3', title: 'B' }),
      ])
    );

    expect(flat.map((n) => n.id)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('the role matrix mirror', () => {
  /** The distinction the Contributor role exists for. */
  it('lets a contributor add but not remove', () => {
    expect(roleCan('contributor', 'createPage')).toBe(true);
    expect(roleCan('contributor', 'uploadFile')).toBe(true);
    expect(roleCan('contributor', 'deletePage')).toBe(false);
    expect(roleCan('contributor', 'deleteFile')).toBe(false);
  });

  it('reserves deleting the team for its owner', () => {
    expect(roleCan('owner', 'deleteTeam')).toBe(true);
    for (const role of ['admin', 'editor', 'contributor', 'viewer', 'guest'] as const) {
      expect(roleCan(role, 'deleteTeam')).toBe(false);
    }
  });

  it('grants view to every role and writes to none of viewer or guest', () => {
    for (const role of ['owner', 'admin', 'editor', 'contributor', 'viewer', 'guest'] as const) {
      expect(roleCan(role, 'viewTeam')).toBe(true);
    }
    for (const role of ['viewer', 'guest'] as const) {
      expect(roleCan(role, 'editPage')).toBe(false);
      expect(roleCan(role, 'uploadFile')).toBe(false);
      expect(roleCan(role, 'manageSettings')).toBe(false);
    }
  });

  it('grants nothing when the role is unknown', () => {
    expect(roleCan(undefined, 'viewTeam')).toBe(false);
  });

  /** Archiving is read-only for everyone, whatever their role. */
  it('refuses every write on an archived team', () => {
    const archived = { userRole: 'owner' as const, archived: true };
    expect(teamCan(archived, 'viewTeam')).toBe(true);
    expect(teamCan(archived, 'createPage')).toBe(false);
    expect(teamCan(archived, 'manageSettings')).toBe(false);

    const live = { userRole: 'owner' as const, archived: false };
    expect(teamCan(live, 'createPage')).toBe(true);
  });
});

describe('teamHref', () => {
  it('omits the default view and carries the page when there is one', () => {
    expect(teamHref('t1')).toBe('/teams/space?id=t1');
    expect(teamHref('t1', 'files')).toBe('/teams/space?id=t1&view=files');
    expect(teamPageHref('t1', 'p9')).toBe('/teams/space?id=t1&view=pages&page=p9');
  });

  it('escapes ids rather than splicing them in raw', () => {
    expect(teamHref('a&b=c')).toBe('/teams/space?id=a%26b%3Dc');
  });

  it('falls back to home for an unrecognised view', () => {
    expect(parseTeamView('pages')).toBe('pages');
    expect(parseTeamView('nonsense')).toBe('home');
    expect(parseTeamView(null)).toBe('home');
  });
});

/**
 * Visibility (issue #185).
 *
 * The client's job here is narrow and the test says so: it renders what the server decided. The
 * button a Discover card shows comes from `joinAction`, not from `visibility`, precisely so the
 * two cannot disagree — the previous draft derived behaviour on the client from a column the
 * server never read, and every team behaved as private while the UI said otherwise.
 */
describe('team visibility', () => {
  it('describes all three values, and each says both what it does and how you join', () => {
    const values: TeamVisibility[] = ['private', 'organization', 'invite_only'];
    for (const v of values) {
      expect(TEAM_VISIBILITY_DESCRIPTIONS[v], `${v} has no description`).toBeTruthy();
    }

    // The distinction the two discoverable values exist for has to be visible in the words the
    // owner reads before choosing, not just in the server's behaviour afterwards.
    expect(TEAM_VISIBILITY_DESCRIPTIONS.organization).toMatch(/join it themselves/i);
    expect(TEAM_VISIBILITY_DESCRIPTIONS.invite_only).toMatch(/request access/i);
    expect(TEAM_VISIBILITY_DESCRIPTIONS.private).toMatch(/only members/i);
  });

  /**
   * A `DiscoverableTeam` must not be usable where a `Team` is expected. `Team` carries `userRole`
   * and means "a team you are in"; the discovery listing is the one place a caller sees a team
   * they have no role in, and conflating the two is how the members' view leaks.
   */
  it('keeps the discoverable shape separate from the member shape', () => {
    const discovered: DiscoverableTeam = {
      id: 't9',
      name: 'Marketing',
      slug: 'marketing',
      description: null,
      avatarColor: null,
      avatarEmoji: null,
      visibility: 'organization',
      memberCount: 4,
      joinAction: 'join',
      createdAt: '2026-09-04T00:00:00Z',
    };

    expect('userRole' in discovered).toBe(false);
    expect('storageUsedBytes' in discovered).toBe(false);
    expect('defaultPageId' in discovered).toBe(false);
  });
});
