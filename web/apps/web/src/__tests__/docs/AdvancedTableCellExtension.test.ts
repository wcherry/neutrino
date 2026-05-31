/**
 * Unit tests for AdvancedTableCellExtension.
 *
 * Covers:
 *   - Extension is named tableCell (inherits from TableCell)
 *   - Adds backgroundColor, borderColor, borderWidth attributes
 *   - Each attribute defaults to null
 *   - backgroundColor renders as background-color style
 *   - borderColor renders as border-color style
 *   - borderWidth renders as border-width style
 *   - Null values produce empty objects (no stray style attributes)
 */

import { describe, it, expect } from 'vitest';
import { AdvancedTableCell } from '../../lib/extensions/AdvancedTableCellExtension';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RenderResult = Record<string, string>;

type AttrSpec = {
  default: unknown;
  parseHTML: (el: HTMLElement) => unknown;
  renderHTML: (attrs: Record<string, unknown>) => RenderResult;
};

/** Call addAttributes with a parent that returns {} so we only get our custom attrs. */
function getAttrs(): Record<string, AttrSpec> {
  const fn = AdvancedTableCell.config.addAttributes;
  if (typeof fn !== 'function') return {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (fn as any).call({ parent: () => ({}) }) ?? {};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdvancedTableCell', () => {
  it('is named tableCell (inherits from TableCell)', () => {
    expect(AdvancedTableCell.name).toBe('tableCell');
  });

  describe('backgroundColor attribute', () => {
    it('defaults to null', () => {
      const attrs = getAttrs();
      expect(attrs.backgroundColor?.default).toBeNull();
    });

    it('renders background-color style when set', () => {
      const attrs = getAttrs();
      const result = attrs.backgroundColor?.renderHTML({ backgroundColor: '#fef08a' });
      expect(result?.style).toContain('background-color: #fef08a');
    });

    it('renders empty object when null', () => {
      const attrs = getAttrs();
      const result = attrs.backgroundColor?.renderHTML({ backgroundColor: null });
      expect(result).toEqual({});
    });
  });

  describe('borderColor attribute', () => {
    it('defaults to null', () => {
      const attrs = getAttrs();
      expect(attrs.borderColor?.default).toBeNull();
    });

    it('renders border-color style when set', () => {
      const attrs = getAttrs();
      const result = attrs.borderColor?.renderHTML({ borderColor: '#1a73e8' });
      expect(result?.style).toContain('border-color: #1a73e8');
    });

    it('renders empty object when null', () => {
      const attrs = getAttrs();
      const result = attrs.borderColor?.renderHTML({ borderColor: null });
      expect(result).toEqual({});
    });
  });

  describe('borderWidth attribute', () => {
    it('defaults to null', () => {
      const attrs = getAttrs();
      expect(attrs.borderWidth?.default).toBeNull();
    });

    it('renders border-width style when set', () => {
      const attrs = getAttrs();
      const result = attrs.borderWidth?.renderHTML({ borderWidth: '2px' });
      expect(result?.style).toContain('border-width: 2px');
    });

    it('renders empty object when null', () => {
      const attrs = getAttrs();
      const result = attrs.borderWidth?.renderHTML({ borderWidth: null });
      expect(result).toEqual({});
    });
  });
});
