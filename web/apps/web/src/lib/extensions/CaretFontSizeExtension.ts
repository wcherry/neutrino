/**
 * CaretFontSizeExtension
 *
 * Makes the native blinking caret's height reflect the `fontSize` textStyle
 * mark that is about to be typed, but only inside a completely empty block
 * (empty paragraph/heading, or an empty document). Marks only materialize as
 * DOM spans once text exists, so an empty block has no span to size the
 * caret against and the browser falls back to the container's default font
 * size until the first keystroke.
 *
 * The widget below is a real inline box, so it stretches the line box of
 * whatever line the cursor is on — harmless on a genuinely empty line (there
 * is nothing else there to push around), but wrong on a line that already
 * has real text: that text already renders its own correctly-sized spans,
 * the native caret already matches them without help, and mark resolution
 * at a paragraph boundary can inherit a stale/larger size from a
 * neighboring line — stretching an unrelated line's height and making
 * content visibly jump as the cursor moves. So this only ever fires when
 * the current block has zero content.
 */

import { Extension } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';

const caretFontSizePluginKey = new PluginKey('caretFontSize');

function getActiveFontSize(state: EditorState): string | null {
  const { selection, storedMarks } = state;
  if (!selection.empty) return null;
  if (selection.$from.parent.content.size > 0) return null;

  const marks = storedMarks ?? selection.$from.marks();
  const textStyleMark = marks.find(m => m.type.name === 'textStyle');
  return (textStyleMark?.attrs.fontSize as string | undefined) ?? null;
}

function buildDecorations(state: EditorState): DecorationSet {
  const fontSize = getActiveFontSize(state);
  if (!fontSize) return DecorationSet.empty;

  const anchor = document.createElement('span');
  anchor.className = 'caret-font-size-anchor';
  anchor.style.fontSize = fontSize;
  anchor.textContent = '​';

  const pos = state.selection.from;
  return DecorationSet.create(state.doc, [
    // Key includes fontSize so ProseMirror re-renders the widget's DOM node
    // (rather than reusing the stale one) whenever the size actually changes.
    Decoration.widget(pos, anchor, { key: `caret-font-size-${fontSize}`, side: 0 }),
  ]);
}

export const CaretFontSizeExtension = Extension.create({
  name: 'caretFontSize',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: caretFontSizePluginKey,

        state: {
          init: (_config, state) => buildDecorations(state),
          apply: (_tr, _old, _oldState, newState) => buildDecorations(newState),
        },

        props: {
          decorations(state) {
            return caretFontSizePluginKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
