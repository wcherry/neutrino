/**
 * Unit tests for ListStyleExtension.
 *
 * Covers:
 *   - Extension has the correct name
 *   - Adds listStyleType attribute to bulletList and orderedList
 *   - Bullet list defaults to 'disc'
 *   - Ordered list defaults to 'decimal'
 *   - Non-default styles render as inline style attribute
 *   - Default values do not render inline style
 *   - Exports the expected style option arrays
 */

import { describe, it, expect } from 'vitest';
import {
  ListStyleExtension,
  BULLET_LIST_STYLES,
  ORDERED_LIST_STYLES,
} from '../../lib/extensions/ListStyleExtension';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AttrDef = {
  types: string[];
  attributes: Record<string, {
    default: unknown;
    parseHTML: (el: HTMLElement) => unknown;
    renderHTML: (attrs: Record<string, unknown>) => Record<string, string>;
  }>;
};

/** Call the addGlobalAttributes config method with a minimal context. */
function getAttrDefs(): AttrDef[] {
  const fn = ListStyleExtension.config.addGlobalAttributes;
  if (typeof fn !== 'function') return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (fn as any).call({} as any) ?? [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ListStyleExtension', () => {
  it('has the correct name', () => {
    expect(ListStyleExtension.name).toBe('listStyle');
  });

  it('registers attributes for bulletList and orderedList', () => {
    const attrDefs = getAttrDefs();
    const types = attrDefs.flatMap((d) => d.types);
    expect(types).toContain('bulletList');
    expect(types).toContain('orderedList');
  });

  it('bulletList listStyleType defaults to disc', () => {
    const attrDefs = getAttrDefs();
    const bulletDef = attrDefs.find((d) => d.types.includes('bulletList'));
    expect(bulletDef?.attributes.listStyleType.default).toBe('disc');
  });

  it('orderedList listStyleType defaults to decimal', () => {
    const attrDefs = getAttrDefs();
    const orderedDef = attrDefs.find((d) => d.types.includes('orderedList'));
    expect(orderedDef?.attributes.listStyleType.default).toBe('decimal');
  });

  it('non-default bulletList style renders an inline style', () => {
    const attrDefs = getAttrDefs();
    const bulletDef = attrDefs.find((d) => d.types.includes('bulletList'));
    const rendered = bulletDef?.attributes.listStyleType.renderHTML({ listStyleType: 'circle' });
    expect(rendered?.style).toBe('list-style-type: circle');
  });

  it('default disc bulletList style does NOT render an inline style', () => {
    const attrDefs = getAttrDefs();
    const bulletDef = attrDefs.find((d) => d.types.includes('bulletList'));
    const rendered = bulletDef?.attributes.listStyleType.renderHTML({ listStyleType: 'disc' });
    // Default value should produce empty object (no unnecessary style attr)
    expect(rendered).toEqual({});
  });

  it('non-default orderedList style renders an inline style', () => {
    const attrDefs = getAttrDefs();
    const orderedDef = attrDefs.find((d) => d.types.includes('orderedList'));
    const rendered = orderedDef?.attributes.listStyleType.renderHTML({
      listStyleType: 'lower-alpha',
    });
    expect(rendered?.style).toBe('list-style-type: lower-alpha');
  });
});

// ---------------------------------------------------------------------------
// Style option arrays
// ---------------------------------------------------------------------------

describe('BULLET_LIST_STYLES', () => {
  it('contains disc, circle, square, none', () => {
    const values = BULLET_LIST_STYLES.map((s) => s.value);
    expect(values).toContain('disc');
    expect(values).toContain('circle');
    expect(values).toContain('square');
    expect(values).toContain('none');
  });

  it('each entry has label and value', () => {
    for (const entry of BULLET_LIST_STYLES) {
      expect(typeof entry.label).toBe('string');
      expect(typeof entry.value).toBe('string');
    }
  });
});

describe('ORDERED_LIST_STYLES', () => {
  it('contains decimal, lower-alpha, upper-alpha, lower-roman, upper-roman', () => {
    const values = ORDERED_LIST_STYLES.map((s) => s.value);
    expect(values).toContain('decimal');
    expect(values).toContain('lower-alpha');
    expect(values).toContain('upper-alpha');
    expect(values).toContain('lower-roman');
    expect(values).toContain('upper-roman');
  });
});
