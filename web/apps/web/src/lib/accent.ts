/**
 * The user's accent colour (customization roadmap U3), with a contrast guarantee: whatever is
 * picked, what is drawn reaches 4.5:1 — against white in light mode, against the darkest ground
 * in dark mode. The stored value is the colour as chosen; only what is drawn is adjusted, so a
 * later change to the grounds re-derives it rather than compounding an old adjustment.
 *
 * The arithmetic is `src/branding/color.rs`'s, so a user's accent and an instance's brand accent
 * behave the same way. The CSS it produces uses the same selectors as the brand's and is inserted
 * after it, so a user's own accent wins over the instance's.
 */

type Rgb = [number, number, number];

export const LIGHT_GROUND: Rgb = [0xff, 0xff, 0xff];
export const DARK_GROUND: Rgb = [0x0f, 0x11, 0x15];
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
export const TEXT_CONTRAST = 4.5;

/** Where the derived CSS is kept for the anti-FOUC script (`lib/antiFouc.ts`). Device-local. */
export const ACCENT_CSS_KEY = 'neutrino.prefs.accentCss';

export function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

const toHex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

function luminance([r, g, b]: Rgb): number {
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return a.map((v, i) => Math.round(Math.min(255, Math.max(0, v + (b[i] - v) * t)))) as Rgb;
}

/** The least mix toward `toward`, in 5 % steps, that reaches `ratio` against `ground`. */
function untilContrast(c: Rgb, toward: Rgb, ground: Rgb, ratio: number): Rgb {
  for (let step = 0; step <= 20; step += 1) {
    const m = mix(c, toward, step / 20);
    if (contrast(m, ground) >= ratio) return m;
  }
  return toward;
}

export interface AccentPalette {
  light: string;
  lightHover: string;
  lightSubtle: string;
  lightText: string;
  dark: string;
  darkHover: string;
  darkSubtle: string;
  darkText: string;
  /** True when the colour as chosen was too light (or too dark) and was adjusted to be legible. */
  adjusted: boolean;
}

export function accentPalette(hex: string): AccentPalette | null {
  const chosen = parseHex(hex);
  if (!chosen) return null;
  const light = untilContrast(chosen, BLACK, LIGHT_GROUND, TEXT_CONTRAST);
  const dark = untilContrast(chosen, WHITE, DARK_GROUND, TEXT_CONTRAST);
  return {
    light: toHex(light),
    lightHover: toHex(mix(light, BLACK, 0.18)),
    lightSubtle: toHex(mix(light, WHITE, 0.92)),
    lightText: toHex(mix(light, BLACK, 0.25)),
    dark: toHex(dark),
    darkHover: toHex(mix(dark, WHITE, 0.2)),
    darkSubtle: toHex(mix(chosen, DARK_GROUND, 0.78)),
    darkText: toHex(mix(dark, WHITE, 0.3)),
    adjusted: toHex(light) !== toHex(chosen) || toHex(dark) !== toHex(chosen),
  };
}

/** The accent as custom properties for light and dark — the brand accent's selectors and shape. */
export function accentCss(hex: string | null | undefined): string {
  const p = hex ? accentPalette(hex) : null;
  if (!p) return '';
  const block = (theme: string, a: string, h: string, s: string, t: string) =>
    `html:root[data-theme="${theme}"]{--brand-accent:${a};--brand-accent-hover:${h};--color-accent:${a};--color-accent-hover:${h};--color-accent-subtle:${s};--color-accent-text:${t};--app-color-drive:${a}}`;
  return (
    block('light', p.light, p.lightHover, p.lightSubtle, p.lightText) +
    block('dark', p.dark, p.darkHover, p.darkSubtle, p.darkText)
  );
}
