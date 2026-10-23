import { describe, it, expect, beforeEach } from 'vitest';
import { ANTI_FOUC_SCRIPT } from '@/lib/antiFouc';
import { BOOT_KEY, BOOT_OWN_KEY } from '@neutrino/preferences';
import { ACCENT_CSS_KEY, accentCss } from '@/lib/accent';

/*
 * The script that sets the look, density and theme before first paint. It runs before React and
 * reads two things: this browser's boot record, and the organisation's layer the server writes
 * into the page (`window.__NEUTRINO_INSTANCE__`). These pin the order the store resolves in
 * (`@neutrino/preferences`): a lock wins, the user's own choice beats an org default, and a newer
 * org default beats a value the record merely inherited.
 */

type Instance = { org?: { values: Record<string, unknown>; locked: string[] } };

function run(boot: Record<string, unknown> | null, instance?: Instance): HTMLElement {
  const html = document.documentElement;
  for (const a of ['data-look', 'data-density', 'data-theme', 'data-text-size', 'data-reduce-motion', 'data-transparency', 'data-contrast']) html.removeAttribute(a);
  document.getElementById('neutrino-accent')?.remove();
  localStorage.clear();
  if (boot) localStorage.setItem(BOOT_KEY, JSON.stringify(boot));
  (window as unknown as { __NEUTRINO_INSTANCE__?: Instance }).__NEUTRINO_INSTANCE__ = instance;
  new Function(ANTI_FOUC_SCRIPT)();
  return html;
}

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia;
});

describe('the anti-FOUC script', () => {
  it('applies the boot record when the page carries no org layer', () => {
    const html = run({ 'appearance.look': 'precision', 'appearance.density': 'compact', 'appearance.theme': 'dark' });
    expect(html.getAttribute('data-look')).toBe('precision');
    expect(html.getAttribute('data-density')).toBe('compact');
    expect(html.getAttribute('data-theme')).toBe('dark');
  });

  it("lets a locked org value win over the user's own choice", () => {
    const html = run(
      { 'appearance.look': 'blended', [BOOT_OWN_KEY]: ['appearance.look'] },
      { org: { values: { 'appearance.look': 'precision' }, locked: ['appearance.look'] } },
    );
    expect(html.getAttribute('data-look')).toBe('precision');
  });

  it("keeps the user's own choice over an unlocked org default", () => {
    const html = run(
      { 'appearance.density': 'spacious', [BOOT_OWN_KEY]: ['appearance.density'] },
      { org: { values: { 'appearance.density': 'compact' }, locked: [] } },
    );
    expect(html.getAttribute('data-density')).toBe('spacious');
  });

  it('replaces an inherited value with a newer org default', () => {
    // The record was written when the org default was Light Flow; the admin has since changed it.
    const html = run(
      { 'appearance.look': 'lightflow', [BOOT_OWN_KEY]: [] },
      { org: { values: { 'appearance.look': 'blended' }, locked: [] } },
    );
    expect(html.getAttribute('data-look')).toBe('blended');
  });

  it('applies the org default on a device that has never loaded the app', () => {
    const html = run(null, { org: { values: { 'appearance.look': 'precision', 'appearance.theme': 'dark' }, locked: [] } });
    expect(html.getAttribute('data-look')).toBe('precision');
    expect(html.getAttribute('data-theme')).toBe('dark');
  });

  it('ignores values it does not recognise, wherever they came from', () => {
    const html = run(
      { 'appearance.look': 'neon' },
      { org: { values: { 'appearance.density': 'huge', 'appearance.theme': '"><script>' }, locked: ['appearance.theme'] } },
    );
    expect(html.getAttribute('data-look')).toBeNull();
    expect(html.getAttribute('data-density')).toBeNull();
    expect(html.getAttribute('data-theme')).toBe('light');
  });

  it('applies text size, motion, transparency and contrast, and leaves `system` to the OS', () => {
    const html = run({
      'appearance.textSize': 'lg', 'a11y.reduceMotion': 'on', 'a11y.reduceTransparency': 'on', 'a11y.contrast': 'more',
    });
    expect(html.getAttribute('data-text-size')).toBe('lg');
    expect(html.getAttribute('data-reduce-motion')).toBe('on');
    expect(html.getAttribute('data-transparency')).toBe('off');
    expect(html.getAttribute('data-contrast')).toBe('more');
    const plain = run({ 'appearance.textSize': 'md', 'a11y.reduceMotion': 'system', 'a11y.contrast': 'system' });
    expect(plain.getAttribute('data-text-size')).toBeNull();
    expect(plain.getAttribute('data-reduce-motion')).toBeNull();
    expect(plain.getAttribute('data-contrast')).toBeNull();
  });

  it('paints the remembered accent only while the preference still has one', () => {
    // No derived CSS on this device yet: nothing to paint (the ThemeProvider adds it after load).
    run({ 'appearance.accent': '#0e7a4a' });
    expect(document.getElementById('neutrino-accent')).toBeNull();
    // With it: painted before React runs.
    localStorage.setItem(ACCENT_CSS_KEY, accentCss('#0e7a4a'));
    new Function(ANTI_FOUC_SCRIPT)();
    expect(document.getElementById('neutrino-accent')?.textContent).toContain('--brand-accent:#0e7a4a');
    // The accent was cleared since: the stale CSS is not applied.
    document.getElementById('neutrino-accent')!.remove();
    localStorage.setItem(BOOT_KEY, JSON.stringify({ 'appearance.accent': null }));
    new Function(ANTI_FOUC_SCRIPT)();
    expect(document.getElementById('neutrino-accent')).toBeNull();
  });
});
