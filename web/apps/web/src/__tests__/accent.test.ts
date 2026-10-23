import { describe, it, expect } from 'vitest';
import { accentPalette, accentCss, contrast, parseHex, DARK_GROUND, LIGHT_GROUND } from '@/lib/accent';

describe('the accent colour (U3)', () => {
  it('keeps a legible colour as chosen', () => {
    const p = accentPalette('#3346e8')!;
    expect(p.light).toBe('#3346e8');
    expect(p.adjusted).toBe(true); // too dark for the dark ground, so dark mode lifts it
  });

  it('darkens a colour too light to read, and lifts one too dark for dark mode, to 4.5:1', () => {
    for (const hex of ['#ffd400', '#7fd1ff', '#13945a', '#1a1a80', '#000000', '#ffffff']) {
      const p = accentPalette(hex)!;
      expect(contrast(parseHex(p.light)!, LIGHT_GROUND), `${hex} light`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parseHex(p.dark)!, DARK_GROUND), `${hex} dark`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('writes custom properties only for a real colour', () => {
    expect(accentCss('#0e7a4a')).toContain('html:root[data-theme="light"]{--brand-accent:#0e7a4a;');
    for (const bad of ['', null, 'red', '#0e7a4a;}', 'url(x)']) expect(accentCss(bad)).toBe('');
  });
});
