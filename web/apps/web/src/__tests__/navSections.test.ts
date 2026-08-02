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
