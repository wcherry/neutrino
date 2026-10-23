import { describe, it, expect } from 'vitest';
import { schema } from '@tiptap/pm/schema-basic';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { Decoration, type DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import {
  buildAll,
  forEachText,
  mapWindow,
  moveWindow,
  transactionDiff,
  updateForTransaction,
  withinWindow,
  type DecorationWindow,
} from '@/lib/extensions/incrementalDecorations';

/** A stand-in check: flag every word containing "zz", the way spell-check flags a misspelling. */
function check(block: PmNode, pos: number): Decoration[] {
  const out: Decoration[] = [];
  forEachText(block, pos, (text, at) => {
    const re = /\w*zz\w*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push(Decoration.inline(at + m.index, at + m.index + m[0].length, { class: 'x' }));
  });
  return out;
}

const ranges = (set: DecorationSet, doc: PmNode) => set.find(0, doc.content.size).map((d) => `${d.from}-${d.to}`).sort();

/** A tiny deterministic random source, so a failure reproduces. */
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

describe('per-paragraph decorations', () => {
  it('match a full rebuild after every one of many random edits', () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) => schema.node('paragraph', null, [schema.text(`line ${i} buzz fizz plain${i % 3 ? ' jazz' : ''}`)]));
    let state = EditorState.create({ schema, doc: schema.node('doc', null, paragraphs) });
    let set = buildAll(state.doc, check);
    const r = rng(7);
    const words = ['zz', 'a', ' ', 'pizza', 'buzzard ', 'x'];
    let applied = 0;
    for (let i = 0; i < 400; i += 1) {
      const size = state.doc.content.size;
      const a = 1 + Math.floor(r() * (size - 2));
      // Only positions inside a paragraph: text cannot go between two.
      if (!state.doc.resolve(a).parent.isTextblock) continue;
      const tr = state.tr;
      const op = r();
      try {
        if (op < 0.45) tr.insertText(words[Math.floor(r() * words.length)], a);
        else if (op < 0.75) tr.delete(a, Math.min(size - 1, a + 1 + Math.floor(r() * 12)));
        else if (op < 0.9) tr.setSelection(TextSelection.create(tr.doc, a)).split(tr.selection.from);
        else tr.insertText('zz', a).insertText('q', Math.min(a + 5, tr.doc.content.size - 1));
      } catch {
        continue; // an edit the schema refuses; pick another
      }
      if (!tr.docChanged) continue;
      set = updateForTransaction(set, tr, check);
      state = state.apply(tr);
      applied += 1;
      expect(ranges(set, state.doc), `edit ${i}`).toEqual(ranges(buildAll(state.doc, check), state.doc));
    }
    // Most random positions are inside a paragraph; make sure the comparison really ran.
    expect(applied).toBeGreaterThan(250);
  });

  it('match a full rebuild of the window as it moves and the document is edited', () => {
    const paragraphs = Array.from({ length: 60 }, (_, i) => schema.node('paragraph', null, [schema.text(`p${i} buzz ok${i % 2 ? ' fizz' : ''}`)]));
    let state = EditorState.create({ schema, doc: schema.node('doc', null, paragraphs) });
    // A window over blocks a..b of the current document.
    const over = (a: number, b: number): DecorationWindow => {
      let from = 0;
      let to = 0;
      state.doc.forEach((node, offset, index) => {
        if (index === a) from = offset;
        if (index === b) to = offset + node.nodeSize;
      });
      return { from, to };
    };
    let window: DecorationWindow = over(0, 10);
    let set = buildAll(state.doc, check, window);
    const r = rng(11);
    for (let i = 0; i < 300; i += 1) {
      if (r() < 0.3) {
        const a = Math.floor(r() * (state.doc.childCount - 5));
        const next = r() < 0.1 ? null : over(a, Math.min(state.doc.childCount - 1, a + 2 + Math.floor(r() * 15)));
        set = moveWindow(set, state.doc, window, next, check);
        window = next;
      } else {
        const a = 1 + Math.floor(r() * (state.doc.content.size - 2));
        if (!state.doc.resolve(a).parent.isTextblock) continue;
        const tr = state.tr.insertText(r() < 0.5 ? 'zz' : 'q ', a);
        // `build` sees positions after the edit, so the window it is limited to is the mapped one.
        window = mapWindow(window, tr);
        set = updateForTransaction(set, tr, withinWindow(window, check));
        state = state.apply(tr);
      }
      expect(ranges(set, state.doc), `step ${i}`).toEqual(ranges(buildAll(state.doc, check, window), state.doc));
    }
  });

  it('treat a whole-document replace that keeps the unchanged nodes as the change it really is', () => {
    // What y-prosemirror dispatches for an undo or a remote edit: one step over everything, with
    // every node it did not change passed through as the same object.
    const paragraphs = Array.from({ length: 40 }, (_, i) => schema.node('paragraph', null, [schema.text(`p${i} buzz fizz`)]));
    const state = EditorState.create({ schema, doc: schema.node('doc', null, paragraphs) });
    const set = buildAll(state.doc, check);
    const children: PmNode[] = [];
    state.doc.forEach((node) => children.push(node));
    children.splice(20, 1, schema.node('paragraph', null, [schema.text('changed jazz')]));
    const tr = state.tr.replaceWith(0, state.doc.content.size, children);

    const diff = transactionDiff(tr)!;
    let at20 = 0;
    tr.doc.forEach((_node, offset, index) => { if (index === 20) at20 = offset; });
    expect(diff.from).toBeGreaterThanOrEqual(at20);
    expect(diff.to).toBeLessThanOrEqual(at20 + children[20].nodeSize);
    const next = updateForTransaction(set, tr, check);
    expect(ranges(next, tr.doc)).toEqual(ranges(buildAll(tr.doc, check), tr.doc));
  });
});
