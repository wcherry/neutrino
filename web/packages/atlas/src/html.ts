import { htmlFlow, htmlText } from 'micromark-core-commonmark';
import type { Construct, Effects, Extension, State, TokenizeContext } from 'micromark-util-types';

/**
 * Raw HTML, with declarations as GFM 0.29 and cmark-gfm (and so AtlasKit) take them: `<!`
 * then an uppercase letter. `<!doctype html>` is text, not an HTML block or inline HTML, though
 * CommonMark 0.31 (and micromark) take any letter.
 */
function upperDeclarations(base: Construct, source: string): Construct {
  return {
    ...base,
    name: `atlas-${base.name}`,
    tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
      const at = source.slice(this.now().offset).replace(/^[ \t]+/, '');
      if (/^<![a-z]/.test(at)) return nok;
      return base.tokenize.call(this, effects, ok, nok);
    },
  };
}

export function atlasHtml(source: string): Extension {
  return {
    disable: { null: ['htmlFlow', 'htmlText'] },
    flow: { 60: upperDeclarations(htmlFlow, source) },
    text: { 60: upperDeclarations(htmlText, source) },
  };
}
