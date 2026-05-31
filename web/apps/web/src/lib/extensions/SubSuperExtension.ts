/**
 * SubSuperExtension — custom Tiptap Mark extensions for superscript and subscript.
 *
 * These marks are not included in TipTap's StarterKit, so we implement them as
 * lightweight custom Mark extensions that render native <sup> / <sub> HTML elements.
 *
 * Superscript keyboard shortcut: Ctrl+.  (Mod+.)
 * Subscript keyboard shortcut:   Ctrl+,  (Mod+,)
 *
 * The marks are mutually exclusive — applying superscript removes subscript and
 * vice versa, matching Word / Google Docs behaviour.
 */

import { Mark, mergeAttributes } from '@tiptap/react';

export const Superscript = Mark.create({
  name: 'superscript',

  /**
   * Mutually exclude subscript — applying superscript removes subscript first.
   */
  excludes: 'subscript',

  parseHTML() {
    return [
      { tag: 'sup' },
      { style: 'vertical-align', value: 'super' },
    ];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['sup', mergeAttributes(HTMLAttributes), 0];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-.': () => this.editor.commands.toggleMark(this.name),
    };
  },
});

export const Subscript = Mark.create({
  name: 'subscript',

  /**
   * Mutually exclude superscript — applying subscript removes superscript first.
   */
  excludes: 'superscript',

  parseHTML() {
    return [
      { tag: 'sub' },
      { style: 'vertical-align', value: 'sub' },
    ];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['sub', mergeAttributes(HTMLAttributes), 0];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-,': () => this.editor.commands.toggleMark(this.name),
    };
  },
});
