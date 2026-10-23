/**
 * The sidebar's section layout: Drive views stay in the unlabelled first
 * section, every application sits under the "Apps" header, and each app entry
 * points at its own page (issue #66).
 */

import { describe, it, expect } from 'vitest';
import { getNavSections, activeHref, withActiveItem } from '../app/(apps)/navSections';

function section(id: string) {
  const found = getNavSections(false, []).find((s) => s.id === id);
  if (!found) throw new Error(`no nav section "${id}"`);
  return found;
}

describe('getNavSections', () => {
  it('puts every application under an "Apps" header', () => {
    const apps = section('apps');

    expect(apps.label).toBe('Apps');
    expect(apps.items.map((i) => [i.label, i.href])).toEqual([
      ['Docs', '/docs'],
      ['Sheets', '/sheets'],
      ['Slides', '/slides'],
      ['Notes', '/notes'],
      ['Diagrams', '/diagrams'],
      ['Drawings', '/drawing'],
      ['Photos', '/photos'],
      ['Calendar', '/calendar'],
    ]);
  });

  it('leaves only Drive views in the first, unlabelled section', () => {
    const main = section('main');

    expect(main.label).toBeUndefined();
    expect(main.items.map((i) => i.href)).toEqual([
      '/drive',
      '/drive/shared',
      '/drive/recent',
      '/drive/starred',
      '/drive/trash',
    ]);
  });

  it('appends the Administration section only for admins', () => {
    expect(getNavSections(false, []).some((s) => s.id === 'admin')).toBe(false);
    expect(getNavSections(true, []).some((s) => s.id === 'admin')).toBe(true);
  });
});

describe('activeHref', () => {
  const sections = getNavSections(false, []);

  it('matches an app page exactly', () => {
    expect(activeHref(sections, '/sheets')).toBe('/sheets');
  });

  it('keeps the app entry active inside its editor', () => {
    expect(activeHref(sections, '/docs/editor')).toBe('/docs');
    expect(activeHref(sections, '/drawing/editor')).toBe('/drawing');
  });

  it('prefers the longest match so Drive sub-views do not light up My Drive', () => {
    expect(activeHref(sections, '/drive/trash')).toBe('/drive/trash');
  });

  it('returns undefined for a path no entry covers', () => {
    expect(activeHref(sections, '/settings')).toBeUndefined();
  });
});

describe('withActiveItem', () => {
  it('marks exactly one item active', () => {
    const marked = withActiveItem(getNavSections(false, []), '/slides');
    const active = marked.flatMap((s) => s.items).filter((i) => i.active);

    expect(active.map((i) => i.href)).toEqual(['/slides']);
  });
});

/**
 * Team Spaces replaces Shared Drives in the sidebar rather than sitting beside it (issue #185).
 *
 * Two entries would be two answers to "where does my team's stuff live", and replacing is also
 * what makes the flag a real kill switch: turning it off puts the old entry back, and the Shared
 * Drives page and its endpoint were never removed — they are what the iOS and macOS clients read.
 */
describe('the Team section and the teamSpaces flag', () => {
  it('shows Shared Drives while the flag is off', () => {
    const team = getNavSections(false, [], false).find((s) => s.id === 'team');
    expect(team?.items.map((i) => [i.label, i.href])).toEqual([
      ['Shared Drives', '/drive/team'],
    ]);
  });

  it('replaces it with Shared Spaces when the flag is on', () => {
    const team = getNavSections(false, [], true).find((s) => s.id === 'team');
    expect(team?.items.map((i) => [i.label, i.href])).toEqual([['Shared Spaces', '/teams']]);
  });

  /**
   * Fails closed: a caller that has not read the flag — or is rendering before the flag map has
   * arrived — gets the pre-#185 sidebar rather than an entry that appears and then disappears.
   */
  it('defaults to the pre-Team-Spaces sidebar', () => {
    const team = getNavSections(false, []).find((s) => s.id === 'team');
    expect(team?.items[0].label).toBe('Shared Drives');
  });

  it('lights up the Shared Spaces entry inside a team', () => {
    const sections = getNavSections(false, [], true);
    expect(activeHref(sections, '/teams/space')).toBe('/teams');
  });
});

describe('the organisation and team parts of the sidebar (UI roadmap stage 3)', () => {
  it('leaves out the apps an administrator has hidden, and keeps the rest in order', () => {
    const apps = getNavSections(false, [], false, { enabledApps: ['calendar', 'docs'] }).find((s) => s.id === 'apps')!;
    expect(apps.items.map((i) => i.label)).toEqual(['Docs', 'Calendar']);
  });

  it('lists the user\'s teams in the new shell, each in its own colour, and never an unsafe one', () => {
    const team = (id: string, name: string, avatarColor: string | null, extra = {}) => ({
      id, name, avatarColor, avatarEmoji: null, archived: false, ...extra,
    }) as unknown as import('@/lib/api').Team;
    const teams = getNavSections(false, [], true, {
      teams: [
        team('t1', 'Design', '#16a34a'),
        team('t2', 'finance', 'url(https://example.com/x)'),
        team('t3', 'Old', '#2563eb', { archived: true }),
      ],
    }).find((s) => s.id === 'team')!;
    expect(teams.label).toBe('Teams');
    expect(teams.items.map((i) => i.label)).toEqual(['Design', 'finance', 'All teams']);
    expect(teams.items[0].swatch).toEqual({ color: '#16a34a', text: 'D' });
    expect(teams.items[1].swatch?.color).toBe('var(--brand-accent)');
  });

  it('keeps the classic single Team entry when no team list is given', () => {
    const team = getNavSections(false, [], true).find((s) => s.id === 'team')!;
    expect(team.items.map((i) => i.label)).toEqual(['Shared Spaces']);
  });
});
