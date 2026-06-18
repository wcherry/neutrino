/**
 * Unit tests for AdvancedImageExtension.
 *
 * Covers:
 *   - Extension is named 'image' (inherits from Image)
 *   - Adds width, alignment, caption attributes
 *   - width defaults to null
 *   - alignment defaults to 'none'
 *   - caption defaults to empty string
 *   - width renders as both style and attribute
 *   - alignment 'none' produces no data-alignment attribute
 *   - non-none alignment renders as data-alignment
 *   - caption renders as data-caption
 */

import { describe, it, expect } from 'vitest';
import { AdvancedImage } from '../../lib/extensions/AdvancedImageExtension';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RenderResult = Record<string, string>;

type AttrSpec = {
  default: unknown;
  parseHTML: (el: HTMLElement) => unknown;
  renderHTML: (attrs: Record<string, unknown>) => RenderResult;
};

function getAttrs(): Record<string, AttrSpec> {
  const fn = AdvancedImage.config.addAttributes;
  if (typeof fn !== 'function') return {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (fn as any).call({ parent: () => ({}) }) ?? {};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdvancedImage', () => {
  it('is named image (inherits from Image)', () => {
    expect(AdvancedImage.name).toBe('image');
  });

  describe('width attribute', () => {
    it('defaults to null', () => {
      const attrs = getAttrs();
      expect(attrs.width?.default).toBeNull();
    });

    it('renders width as inline style and attribute', () => {
      const attrs = getAttrs();
      const result = attrs.width?.renderHTML({ width: '300px' });
      expect(result?.style).toContain('width: 300px');
      expect(result?.width).toBe('300px');
    });

    it('renders empty object when null', () => {
      const attrs = getAttrs();
      const result = attrs.width?.renderHTML({ width: null });
      expect(result).toEqual({});
    });
  });

  describe('alignment attribute', () => {
    it('defaults to none', () => {
      const attrs = getAttrs();
      expect(attrs.alignment?.default).toBe('none');
    });

    it('renders data-alignment for non-none values', () => {
      const attrs = getAttrs();
      for (const alignment of ['left', 'center', 'right', 'float-left', 'float-right']) {
        const result = attrs.alignment?.renderHTML({ alignment });
        expect(result?.['data-alignment']).toBe(alignment);
      }
    });

    it('renders empty object when alignment is none', () => {
      const attrs = getAttrs();
      const result = attrs.alignment?.renderHTML({ alignment: 'none' });
      expect(result).toEqual({});
    });
  });

  describe('caption attribute', () => {
    it('defaults to empty string', () => {
      const attrs = getAttrs();
      expect(attrs.caption?.default).toBe('');
    });

    it('renders data-caption when caption text is set', () => {
      const attrs = getAttrs();
      const result = attrs.caption?.renderHTML({ caption: 'Figure 1' });
      expect(result?.['data-caption']).toBe('Figure 1');
    });

    it('renders empty object when caption is empty string', () => {
      const attrs = getAttrs();
      const result = attrs.caption?.renderHTML({ caption: '' });
      expect(result).toEqual({});
    });
  });
});
