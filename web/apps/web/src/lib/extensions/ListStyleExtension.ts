/**
 * ListStyleExtension — adds list-style-type attribute to bulletList and orderedList nodes.
 *
 * Bullet list style types: disc (default), circle, square, none
 * Ordered list style types: decimal (default), lower-alpha, upper-alpha, lower-roman, upper-roman
 *
 * The attribute is rendered as an inline `list-style-type` CSS property on the
 * <ul> / <ol> element, so it serialises and deserialises correctly through HTML.
 */

import { Extension } from '@tiptap/react';

export type BulletListStyleType = 'disc' | 'circle' | 'square' | 'none';
export type OrderedListStyleType =
  | 'decimal'
  | 'lower-alpha'
  | 'upper-alpha'
  | 'lower-roman'
  | 'upper-roman';

export const BULLET_LIST_STYLES: { label: string; value: BulletListStyleType }[] = [
  { label: '• Bullet (disc)',   value: 'disc' },
  { label: '○ Circle',          value: 'circle' },
  { label: '■ Square',          value: 'square' },
  { label: '— None',            value: 'none' },
];

export const ORDERED_LIST_STYLES: { label: string; value: OrderedListStyleType }[] = [
  { label: '1. Decimal',        value: 'decimal' },
  { label: 'a. Lower alpha',    value: 'lower-alpha' },
  { label: 'A. Upper alpha',    value: 'upper-alpha' },
  { label: 'i. Lower roman',    value: 'lower-roman' },
  { label: 'I. Upper roman',    value: 'upper-roman' },
];

export const ListStyleExtension = Extension.create({
  name: 'listStyle',

  addGlobalAttributes() {
    return [
      {
        types: ['bulletList'],
        attributes: {
          listStyleType: {
            default: 'disc',
            parseHTML: (el: HTMLElement) =>
              (el.style.listStyleType as BulletListStyleType) || 'disc',
            renderHTML: (attrs: Record<string, unknown>) => {
              const t = attrs.listStyleType as string;
              return t && t !== 'disc' ? { style: `list-style-type: ${t}` } : {};
            },
          },
        },
      },
      {
        types: ['orderedList'],
        attributes: {
          listStyleType: {
            default: 'decimal',
            parseHTML: (el: HTMLElement) =>
              (el.style.listStyleType as OrderedListStyleType) || 'decimal',
            renderHTML: (attrs: Record<string, unknown>) => {
              const t = attrs.listStyleType as string;
              return t && t !== 'decimal' ? { style: `list-style-type: ${t}` } : {};
            },
          },
        },
      },
    ];
  },
});
