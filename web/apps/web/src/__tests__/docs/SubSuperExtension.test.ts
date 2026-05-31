/**
 * Unit tests for SubSuperExtension.
 *
 * Covers:
 *   - Superscript mark has the correct name
 *   - Subscript mark has the correct name
 *   - Superscript excludes subscript
 *   - Subscript excludes superscript
 *   - Superscript parses from <sup> tag
 *   - Subscript parses from <sub> tag
 *   - Superscript renders as <sup> element
 *   - Subscript renders as <sub> element
 *   - The two marks have different names
 */

import { describe, it, expect } from 'vitest';
import { Superscript, Subscript } from '../../lib/extensions/SubSuperExtension';

// ---------------------------------------------------------------------------
// Superscript
// ---------------------------------------------------------------------------

describe('Superscript mark', () => {
  it('has the correct name', () => {
    expect(Superscript.name).toBe('superscript');
  });

  it('excludes subscript', () => {
    // config.excludes is set on the Mark extension config
    expect(Superscript.config.excludes).toBe('subscript');
  });

  it('parses from <sup> tag', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parseRules: any[] = (Superscript.config.parseHTML as any)?.() ?? [];
    expect(Array.isArray(parseRules)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseRules.some((r: any) => r.tag === 'sup')).toBe(true);
  });

  it('renders as <sup> element', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rendered = (Superscript.config.renderHTML as any)?.({ HTMLAttributes: {}, mark: {} });
    expect(Array.isArray(rendered)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((rendered as any[])[0]).toBe('sup');
  });
});

// ---------------------------------------------------------------------------
// Subscript
// ---------------------------------------------------------------------------

describe('Subscript mark', () => {
  it('has the correct name', () => {
    expect(Subscript.name).toBe('subscript');
  });

  it('excludes superscript', () => {
    expect(Subscript.config.excludes).toBe('superscript');
  });

  it('parses from <sub> tag', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parseRules: any[] = (Subscript.config.parseHTML as any)?.() ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseRules.some((r: any) => r.tag === 'sub')).toBe(true);
  });

  it('renders as <sub> element', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rendered = (Subscript.config.renderHTML as any)?.({ HTMLAttributes: {}, mark: {} });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((rendered as any[])[0]).toBe('sub');
  });

  it('superscript and subscript have different names', () => {
    expect(Superscript.name).not.toBe(Subscript.name);
  });
});
