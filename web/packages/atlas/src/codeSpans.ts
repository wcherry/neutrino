import { codeText } from 'micromark-core-commonmark';
import type { Code, Construct, Effects, Event, Extension, Resolver, State, TokenizeContext } from 'micromark-util-types';

/**
 * Code spans, opened where cmark-gfm (and so AtlasKit) opens them. cmark looks for a closer
 * with `scan_to_closing_backticks`, which remembers, per run length, where it last saw a run.
 * Once a scan has reached the end of the text without a closer, a later opener whose length's
 * remembered run lies before it is taken to have none, without looking again. A closer found in
 * between overwrites the memory with an earlier position, so in ``` ``x`c` `c` ``` the second
 * `` `c` `` is literal. micromark looks every time; this repeats cmark's bookkeeping, and only
 * when cmark would find a closer does micromark's own construct parse the span.
 *
 * The span's value keeps its first and last space or line ending: cmark strips one of each only
 * after it has dropped the indentation of the lines a span runs on to, so the converter does
 * (`codeSpanValue`).
 */

interface Scan {
  /** Every backtick run from the first opener to the end of the text: offset and length. */
  runs: { at: number; length: number }[];
  /** `scanned_for_backticks`. */
  scanned: boolean;
  /** `backticks[n]`: where the last run of length n seen by a scan starts. */
  last: Map<number, number>;
}

const scans = new WeakMap<object, Scan>();

/** Reads ahead, without consuming, to the end of the text, noting its backtick runs. */
function reader(runs: Scan['runs']): Construct {
  return {
    partial: true,
    tokenize(this: TokenizeContext, effects: Effects, ok: State): State {
      const self = this;
      const step: State = (code: Code) => {
        if (code === null) { effects.exit('atlasScan'); return ok(code); }
        if (code === 96) {
          const at = self.now().offset;
          const run = runs[runs.length - 1];
          if (run && run.at + run.length === at) run.length++;
          else runs.push({ at, length: 1 });
        }
        effects.consume(code);
        return step;
      };
      return (code: Code) => { effects.enter('atlasScan'); return step(code); };
    },
  };
}

/** micromark's resolver, without its padding: the first token is held back from being read as one. */
const keepPadding: Resolver = (events: Event[], context: TokenizeContext) => {
  const first = events[3]?.[1];
  if (first && (first.type === 'lineEnding' || first.type === 'space')) first.type = 'atlasCodeHold';
  return codeText.resolve!(events, context);
};

export function atlasCodeSpans(): Extension {
  const construct: Construct = {
    ...codeText,
    resolve: keepPadding,
    name: 'atlasCodeText',
    tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
      const self = this;
      const decide: State = (code: Code) => {
        const scan = scans.get(self)!;
        const at = self.now().offset;
        const opener = scan.runs.find((r) => r.at === at);
        if (!opener) return nok(code);
        const after = at + opener.length;
        if (scan.scanned && (scan.last.get(opener.length) ?? 0) <= after) return nok(code);
        for (const run of scan.runs) {
          if (run.at < after) continue;
          scan.last.set(run.length, run.at);
          if (run.length === opener.length) return codeText.tokenize.call(self, effects, ok, nok)(code);
        }
        scan.scanned = true;
        return nok(code);
      };
      return (code: Code) => {
        if (scans.has(self)) return decide(code);
        const scan: Scan = { runs: [], scanned: false, last: new Map() };
        scans.set(self, scan);
        return effects.check(reader(scan.runs), decide, decide)(code);
      };
    },
  };
  return { disable: { null: ['codeText'] }, text: { 96: construct } };
}
