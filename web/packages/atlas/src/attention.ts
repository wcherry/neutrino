import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import type { Code, Construct, Effects, Event, Extension, Point, Resolver, State, Token, TokenizeContext } from 'micromark-util-types';

/**
 * Emphasis delimiters (`*`, `_`) whose flanking is judged as cmark-gfm judges it, which is what
 * AtlasKit runs. Two differences from micromark, both in `scan_delims`:
 * - The characters either side of a run are read past any `~`, the strikethrough extension's
 *   delimiter (cmark's `skip_chars`): in `s~~_e_` the `_` follows `s`, a letter, so it can't
 *   open. The start or end of the text counts as a line break.
 * - Punctuation is ASCII punctuation or a Unicode `P*` character, not symbols (`S*`), and
 *   whitespace is cmark's list.
 * Matching runs into emphasis and strong is micromark's resolver, with one change: the "rule of
 * 3" (CommonMark §6.2, rule 9) sums the lengths of the runs as written, as the spec and cmark do,
 * not what's left of them once some of a run has been used. In `*b****b**`, `****` closes the `*`
 * and keeps `***`, and that can't open for `**`: 4 + 2 is a multiple of 3.
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
    resolveAll: resolveAttention,
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
        (token as Run)._length = token.end.offset - token.start.offset;
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
  return { disable: { null: ['attention'] }, text: { 42: construct, 95: construct }, insideSpan: { null: [construct] } };
}

/**
 * Strikethrough (`~`, `~~`) runs, flanking as cmark-gfm's strikethrough extension judges it:
 * `scan_delims` with cmark's whitespace and punctuation, as for emphasis. micromark counts any
 * Unicode whitespace, so in `~a~\u2028` it lets the second `~` close; cmark doesn't. Matching is
 * micromark's.
 */
export function atlasStrikethrough(): Extension {
  const base = gfmStrikethrough();
  const original = (base.text as Record<number, Construct>)[126];
  const construct: Construct = {
    ...original,
    tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
      const self = this;
      const before = charOf(self.previous);
      const judged: State = (code: Code) => {
        const token = self.events[self.events.length - 1][1];
        const after = charOf(code);
        token._open = !isCmarkSpace(after) && (!isCmarkPunct(after) || isCmarkSpace(before) || isCmarkPunct(before));
        token._close = !isCmarkSpace(before) && (!isCmarkPunct(before) || isCmarkSpace(after) || isCmarkPunct(after));
        return ok(code);
      };
      return original.tokenize.call(self, effects, judged, nok);
    },
  };
  return { ...base, text: { 126: construct } };
}

type Run = Token & { _length?: number };

const size = (t: Token) => t.end.offset - t.start.offset;
const moved = (point: Point, by: number): Point => ({ ...point, column: point.column + by, offset: point.offset + by, _bufferIndex: point._bufferIndex! + by });

/** `Array.splice` in chunks, as micromark-util-chunked does, so a long paragraph can't overflow the stack. */
function spliceIn<T>(list: T[], start: number, remove: number, items: T[]): void {
  list.splice(start, remove);
  for (let i = 0; i < items.length; i += 10_000) list.splice(start + i, 0, ...items.slice(i, i + 10_000));
}

/** micromark-util-resolve-all: each resolver once, in order. */
function resolveAllIn(constructs: Partial<Construct>[], events: Event[], context: TokenizeContext): Event[] {
  const called: Resolver[] = [];
  for (const c of constructs) {
    if (c.resolveAll && !called.includes(c.resolveAll)) {
      events = c.resolveAll(events, context);
      called.push(c.resolveAll);
    }
  }
  return events;
}

/** micromark's `resolveAllAttention`, with the rule of 3 on the runs' written lengths (`_length`). */
function resolveAttention(events: Event[], context: TokenizeContext): Event[] {
  let index = -1;
  while (++index < events.length) {
    if (events[index][0] !== 'enter' || events[index][1].type !== 'attentionSequence' || !events[index][1]._close) continue;
    const closer = events[index][1] as Run;
    let open = index;
    while (open--) {
      const opener = events[open][1] as Run;
      if (events[open][0] !== 'exit' || opener.type !== 'attentionSequence' || !opener._open) continue;
      if (context.sliceSerialize(opener).charCodeAt(0) !== context.sliceSerialize(closer).charCodeAt(0)) continue;
      const openLength = opener._length ?? size(opener), closeLength = closer._length ?? size(closer);
      if ((opener._close || closer._open) && closeLength % 3 && !((openLength + closeLength) % 3)) continue;

      const use = size(opener) > 1 && size(closer) > 1 ? 2 : 1;
      const openingSequence = { type: use > 1 ? 'strongSequence' : 'emphasisSequence', start: moved(opener.end, -use), end: { ...opener.end } } as Token;
      const closingSequence = { type: use > 1 ? 'strongSequence' : 'emphasisSequence', start: { ...closer.start }, end: moved(closer.start, use) } as Token;
      const text = { type: use > 1 ? 'strongText' : 'emphasisText', start: { ...opener.end }, end: { ...closer.start } } as Token;
      const group = { type: use > 1 ? 'strong' : 'emphasis', start: { ...openingSequence.start }, end: { ...closingSequence.end } } as Token;
      opener.end = { ...openingSequence.start };
      closer.start = { ...closingSequence.end };

      let next: Event[] = [];
      if (size(opener)) next.push(['enter', opener, context], ['exit', opener, context]);
      next.push(['enter', group, context], ['enter', openingSequence, context], ['exit', openingSequence, context], ['enter', text, context]);
      next = next.concat(resolveAllIn(context.parser.constructs.insideSpan.null ?? [], events.slice(open + 1, index), context));
      next.push(['exit', text, context], ['enter', closingSequence, context], ['exit', closingSequence, context], ['exit', group, context]);
      let offset = 0;
      if (size(closer)) {
        offset = 2;
        next.push(['enter', closer, context], ['exit', closer, context]);
      }
      spliceIn(events, open - 1, index - open + 3, next);
      index = open + next.length - offset - 2;
      break;
    }
  }
  for (const [, token] of events) if (token.type === 'attentionSequence') token.type = 'data';
  return events;
}
