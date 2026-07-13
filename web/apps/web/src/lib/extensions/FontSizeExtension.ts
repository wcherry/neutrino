/**
 * FontSizeExtension — registers a `fontSize` attribute on the `textStyle`
 * mark (from @tiptap/extension-text-style) and exposes setFontSize /
 * unsetFontSize commands.
 *
 * There is no @tiptap/extension-font-size compatible with TipTap v2, so this
 * follows the same pattern as @tiptap/extension-font-family: an attribute
 * must be registered via addAttributes on `textStyle` for ProseMirror to
 * keep it in the schema — otherwise setMark('textStyle', { fontSize }) is
 * silently dropped.
 */

import { Extension } from '@tiptap/react';

export interface FontSizeOptions {
  types: string[];
}

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (fontSize: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

export const FontSizeExtension = Extension.create<FontSizeOptions>({
  name: 'fontSize',

  addOptions() {
    return { types: ['textStyle'] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.fontSize || null,
            renderHTML: (attrs: Record<string, unknown>) => {
              if (!attrs.fontSize) return {};
              return { style: `font-size: ${attrs.fontSize}` };
            },
          },
        },
      },
    ];
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addCommands(): Record<string, (...args: any[]) => any> {
    return {
      setFontSize:
        (fontSize: string) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ chain }: { chain: any }) => {
          return chain().setMark('textStyle', { fontSize }).run();
        },
      unsetFontSize:
        () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ chain }: { chain: any }) => {
          return chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run();
        },
    };
  },
});
