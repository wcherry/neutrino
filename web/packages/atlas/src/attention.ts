import { attention } from 'micromark-core-commonmark';
import type { Code, Construct, Effects, Extension, State, TokenizeContext } from 'micromark-util-types';

/**
 * Emphasis delimiters (`*`, `_`) whose flanking is judged as cmark-gfm judges it, which is what
 * AtlasKit runs. Two differences from micromark, both in `scan_delims`:
 * - The characters either side of a run are read past any `~`, the strikethrough extension's
 *   delimiter (cmark's `skip_chars`): in `s~~_e_` the `_` follows `s`, a letter, so it can't
 *   open. The start or end of the text counts as a line break.
 * - Punctuation is ASCII punctuation or a Unicode `P*` character, not symbols (`S*`), and
 *   whitespace is cmark's list.
 * Matching runs into emphasis and strong is micromark's own resolver, unchanged.
 */

const isCmarkSpace = (c: number) =>
  c === 9 || c === 10 || c === 12 || c === 13 || c === 32 || c === 160 || c === 5760 || (c >= 8192 && c <= 8202) || c === 8239 || c === 8287 || c === 12288;
const isCmarkPunct = (c: number) => (c < 128 ? (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126)
  : c < 0xd800 || c > 0xdfff ? /^\p{P}$/u.test(String.fromCharCode(c)) : false);

/** The character a run's neighbour is read as: a line break for none, a line ending, or a virtual code. */
const charOf = (code: number | null | undefined): number => (code === null || code === undefined || code < 0 ? 10 : code);

export function atlasAttention(source: string): Extension {
  const construct: Construct = {
    name: 'atlasAttention',
    resolveAll: attention.resolveAll,
    tokenize(this: TokenizeContext, effects: Effects, ok: State): State {
      const self = this;
      let marker: number;
      let before: number;

      /** The character before `offset` in the source, read past `~`. */
      const charBefore = (offset: number): number => {
        let i = offset - 1;
        while (i >= 0 && source.charCodeAt(i) === 126) i--;
        return i < 0 ? 10 : source.charCodeAt(i);
      };
      /** The character at `offset` in the source, read past `~`. */
      const charAfter = (offset: number): number => {
        let i = offset;
        while (i < source.length && source.charCodeAt(i) === 126) i++;
        return i >= source.length ? 10 : source.charCodeAt(i);
      };

      const inside: State = (code: Code) => {
        if (code === marker) { effects.consume(code); return inside; }
        const token = effects.exit('attentionSequence');
        const after = code === 126 ? charAfter(self.now().offset) : charOf(code);
        const leftFlanking = !isCmarkSpace(after) && (!isCmarkPunct(after) || isCmarkSpace(before) || isCmarkPunct(before));
        const rightFlanking = !isCmarkSpace(before) && (!isCmarkPunct(before) || isCmarkSpace(after) || isCmarkPunct(after));
        if (marker === 95 /* _ */) {
          token._open = leftFlanking && (!rightFlanking || isCmarkPunct(before));
          token._close = rightFlanking && (!leftFlanking || isCmarkPunct(after));
        } else {
          token._open = leftFlanking;
          token._close = rightFlanking;
        }
        return ok(code);
      };

      return (code: Code) => {
        marker = code as number;
        before = self.previous === 126 ? charBefore(self.now().offset) : charOf(self.previous);
        effects.enter('attentionSequence');
        return inside(code);
      };
    },
  };
  return { disable: { null: ['attention'] }, text: { 42: construct, 95: construct } };
}
