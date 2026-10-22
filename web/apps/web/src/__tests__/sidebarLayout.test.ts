import { describe, it, expect, beforeEach } from 'vitest';
import { preferences } from '@neutrino/preferences';
import { getNavSections } from '../app/(apps)/navSections';
import { applyLayout, moveApp, pinFolder, readLayout, resetLayout, setHidden, unpinFolder, MAX_PINS } from '@/lib/sidebarLayout';

const labels = (sections: ReturnType<typeof applyLayout>, id: string) =>
  sections.find((s) => s.id === id)?.items.map((i) => i.label);

beforeEach(() => resetLayout());

describe('the user\'s sidebar (U8)', () => {
  it('pins folders under the Drive views, and unpins them', () => {
    pinFolder({ id: 'f1', name: 'Taxes' });
    pinFolder({ id: 'f1', name: 'Taxes' });
    const sections = applyLayout(getNavSections(false, []), readLayout());
    expect(sections.map((s) => s.id).slice(0, 2)).toEqual(['main', 'pinned']);
    expect(sections[1].items).toEqual([expect.objectContaining({ label: 'Taxes', href: '/drive?folder=f1' })]);
    unpinFolder('f1');
    expect(preferences.get('shell.sidebar')).toBeNull();
  });

  it('caps the pins', () => {
    for (let i = 0; i < MAX_PINS + 3; i += 1) pinFolder({ id: `f${i}`, name: `F${i}` });
    expect(readLayout().pinned).toHaveLength(MAX_PINS);
  });

  it('hides entries and whole sections, and puts the apps in the user\'s order', () => {
    setHidden('trash', true);
    setHidden('section:tags', true);
    const shown = ['docs', 'sheets', 'slides', 'notes', 'diagrams', 'drawings', 'photos', 'calendar'];
    moveApp(shown, 'calendar', -1);
    moveApp(readLayout().order, 'calendar', -1);
    const sections = applyLayout(getNavSections(false, []), readLayout());
    expect(labels(sections, 'main')).not.toContain('Trash');
    expect(sections.find((s) => s.id === 'tags')).toBeUndefined();
    expect(labels(sections, 'apps')!.slice(-3)).toEqual(['Calendar', 'Drawings', 'Photos']);
  });

  it('ignores a malformed stored layout', () => {
    expect(readLayout({ hidden: 'all', order: [1, 'docs'], pinned: [{ id: 3 }, { id: 'f', name: 'F' }] })).toEqual({
      hidden: [], order: ['docs'], pinned: [{ id: 'f', name: 'F' }],
    });
  });
});
