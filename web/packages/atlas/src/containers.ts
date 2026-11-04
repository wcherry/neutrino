import { blockQuote, list } from 'micromark-core-commonmark';
import type { Code, Construct, Effects, Extension, State, Token, TokenizeContext } from 'micromark-util-types';

/**
 * List and block quote containers, with CommonMark's rule for when a list start interrupts a
 * paragraph, as cmark-gfm (and so AtlasKit) applies it: an empty item can't, and an ordered one
 * must start at 1. micromark applies those limits more widely, in two places:
 * - after any open flow construct, an indented code block included, not just a paragraph;
 * - to a list nested on the same line as a container that just started (`- 2) x`, `* *`),
 *   where nothing is being interrupted.
 * micromark's own constructs do the parsing; only the `interrupt` flag they read is corrected.
 */

/** Where the last new container on a line started, per document tokenizer. */
const lastStart = new WeakMap<object, { line: number; offset: number }>();

/** Whether a container starting here would interrupt a paragraph. */
function interruptsParagraph(self: TokenizeContext): boolean {
  if (!self.interrupt) return false;
  const here = self.now();
  const started = lastStart.get(self);
  if (started && started.line === here.line && started.offset < here.offset) return false;
  // The flow the line would otherwise continue: is it a paragraph? A GFM table whose delimiter
  // row hasn't come yet is still one (`table` is current while it waits to see).
  for (let i = self.events.length - 1; i >= 0; i--) {
    const token = self.events[i][1] as Token & { _tokenizer?: TokenizeContext };
    if (token.type !== 'chunkFlow' || !token._tokenizer) continue;
    const flow = token._tokenizer;
    const name = flow.currentConstruct?.name;
    if (name === 'content') return true;
    // Between lines no construct is current: a paragraph is open when its content is entered and
    // not yet exited (a line of `|`, or an indented line continuing it, leaves it that way).
    if (name === undefined) {
      for (let k = flow.events.length - 1; k >= 0; k--) {
        const [kind, t] = flow.events[k];
        if (t.type === 'content') return kind === 'enter';
        if (t.type !== 'lineEnding' && t.type !== 'chunkContent' && t.type !== 'linePrefix') return false;
      }
      return false;
    }
    if (name !== 'table') return false;
    for (let k = flow.events.length - 1; k >= 0; k--) {
      const type = flow.events[k][1].type;
      if (type === 'tableDelimiterRow') return false;
      if (type === 'table' && flow.events[k][0] === 'enter') return true;
    }
    return true;
  }
  return false;
}

function corrected(base: Construct, name: string): Construct {
  return {
    ...base,
    name,
    tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
      const self = this;
      const at = self.now();
      if (base === list) self.interrupt = interruptsParagraph(self);
      const started: State = (code: Code) => {
        lastStart.set(self, { line: at.line, offset: at.offset });
        return ok(code);
      };
      return base.tokenize.call(self, effects, started, nok);
    },
  };
}

export function atlasContainers(): Extension {
  const atlasList = corrected(list, 'atlasList');
  const atlasQuote = corrected(blockQuote, 'atlasBlockQuote');
  const document: Record<number, Construct> = { 42: atlasList, 43: atlasList, 45: atlasList, 62: atlasQuote };
  for (let digit = 48; digit <= 57; digit++) document[digit] = atlasList;
  // Tried before micromark's own (extensions come first), which stay enabled: their continuation
  // refers to them by identity. Where these fail, the stricter originals fail too.
  return { document };
}
